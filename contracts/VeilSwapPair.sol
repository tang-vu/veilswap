// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    Nox,
    ebool,
    euint256,
    externalEbool,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {ISwapRouter02Minimal} from "./interfaces/ISwapRouter02Minimal.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/IUniswapV3PoolMinimal.sol";
import {VeilSwapEpochLib} from "./libraries/VeilSwapEpochLib.sol";
import {VeilSwapBalances} from "./VeilSwapBalances.sol";

/// @title VeilSwapPair
/// @notice Confidential batch-swap engine for one token pair. Users submit fully
///         encrypted intents (direction, amount, minOut). Each epoch, opposing flow
///         is netted internally inside the encrypted domain and only the net
///         residual is executed as ONE aggregate swap on the public Uniswap V3
///         pool — observers can never link users to trades, and netted volume
///         never touches the public market at all.
///
///         The contract is ownerless: `lockEpoch`, `settleEpoch` and `cancelEpoch`
///         are permissionless. A keeper provides liveness only — settlement inputs
///         are trust-minimized (reference price is read from the pool itself and
///         decrypted totals carry Nox proofs verified on-chain).
contract VeilSwapPair is VeilSwapBalances {
    using SafeERC20 for IERC20;
    using VeilSwapEpochLib for uint256;

    enum EpochPhase {
        None, // uninitialized epoch id
        Open, // accepting intents
        Locked, // eligibility fixed, totals awaiting TEE public decryption
        Settled, // residual executed and payouts credited
        Cancelled // settlement window expired, escrows refunded
    }

    /// @dev Everything a swap intent reveals on-chain is: "this address submitted
    ///      an intent in this epoch". Direction, size and limit stay encrypted.
    struct Intent {
        address owner;
        ebool sellAForB;
        euint256 amountIn; // escrowed amount (encrypted 0 if balance was insufficient)
        euint256 minOut; // minimum acceptable TOTAL output for amountIn
        euint256 includedA; // set at lock: tokenA input entering the batch (else enc. 0)
        euint256 includedB; // set at lock: tokenB input entering the batch (else enc. 0)
    }

    struct Epoch {
        EpochPhase phase;
        uint64 openedAt;
        uint64 deadline;
        uint64 lockedAt;
        euint256 sumAIn; // encrypted eligible tokenA total, publicly decryptable after lock
        euint256 sumBIn; // encrypted eligible tokenB total, publicly decryptable after lock
        uint256 priceAtoBE18; // pool spot at lock time (tokenB per tokenA, 1e18)
        uint256 priceBtoAE18;
        // Settlement record (plaintext by nature — these are the public aggregates).
        uint256 settledSumAIn;
        uint256 settledSumBIn;
        bool sellAResidual;
        uint256 residualIn;
        uint256 uniswapAmountOut;
    }

    // ============ Immutable configuration (no admin keys anywhere) ============

    IUniswapV3PoolMinimal public immutable pool;
    ISwapRouter02Minimal public immutable router;
    uint24 public immutable poolFee;
    bool public immutable aIsToken0;
    uint64 public immutable epochDuration;
    uint32 public immutable maxIntentsPerEpoch;
    uint16 public immutable slippageBps;
    uint64 public immutable cancelGracePeriod;

    // ============ State ============

    uint64 public currentEpochId;
    mapping(uint64 => Epoch) private _epochs;
    mapping(uint64 => Intent[]) private _intents;

    // ============ Events ============

    event EpochOpened(uint64 indexed epochId, uint64 deadline);
    event IntentSubmitted(uint64 indexed epochId, uint256 indexed index, address indexed owner);
    event EpochLocked(uint64 indexed epochId, uint256 intentCount, uint256 priceAtoBE18, euint256 sumAIn, euint256 sumBIn);
    event EpochSettled(
        uint64 indexed epochId,
        uint256 sumAIn,
        uint256 sumBIn,
        bool sellAResidual,
        uint256 residualIn,
        uint256 uniswapAmountOut
    );
    event EpochCancelled(uint64 indexed epochId);

    // ============ Errors ============

    error EpochNotOpen();
    error EpochNotLocked();
    error EpochFull();
    error IntentWindowClosed();
    error LockConditionsNotMet();
    error CancelGraceNotElapsed();
    error PoolTokenMismatch();

    constructor(
        IERC20 tokenA_,
        IERC20 tokenB_,
        IUniswapV3PoolMinimal pool_,
        ISwapRouter02Minimal router_,
        uint24 poolFee_,
        uint64 epochDuration_,
        uint32 maxIntentsPerEpoch_,
        uint16 slippageBps_,
        uint64 cancelGracePeriod_
    ) VeilSwapBalances(tokenA_, tokenB_) {
        address token0 = pool_.token0();
        address token1 = pool_.token1();
        bool aIs0 = token0 == address(tokenA_) && token1 == address(tokenB_);
        bool aIs1 = token0 == address(tokenB_) && token1 == address(tokenA_);
        require(aIs0 || aIs1, PoolTokenMismatch());
        aIsToken0 = aIs0;

        pool = pool_;
        router = router_;
        poolFee = poolFee_;
        epochDuration = epochDuration_;
        maxIntentsPerEpoch = maxIntentsPerEpoch_;
        slippageBps = slippageBps_;
        cancelGracePeriod = cancelGracePeriod_;

        _openNextEpoch();
    }

    // ============ Intents ============

    /// @notice Submits a fully encrypted swap intent into the current epoch.
    ///         Escrow is all-or-nothing over BOTH balances so that neither the
    ///         direction nor a balance shortfall is observable: if the relevant
    ///         balance is insufficient the escrowed amount silently becomes 0
    ///         (decrypt your intent handle via the SDK to check).
    /// @param sellAForB   Encrypted direction: true sells tokenA for tokenB.
    /// @param amountIn    Encrypted input amount (in the direction's input token).
    /// @param minOut      Encrypted minimum total output for `amountIn`; intents
    ///                    whose minOut cannot be guaranteed at the epoch's
    ///                    worst-case price are excluded and refunded at lock.
    function submitIntent(
        externalEbool sellAForB,
        externalEuint256 amountIn,
        externalEuint256 minOut,
        bytes calldata directionProof,
        bytes calldata amountProof,
        bytes calldata minOutProof
    ) external nonReentrant {
        Epoch storage epoch = _epochs[currentEpochId];
        require(epoch.phase == EpochPhase.Open, EpochNotOpen());
        require(block.timestamp < epoch.deadline, IntentWindowClosed());
        Intent[] storage intents = _intents[currentEpochId];
        require(intents.length < maxIntentsPerEpoch, EpochFull());

        ebool direction = Nox.fromExternal(sellAForB, directionProof);
        euint256 amount = Nox.fromExternal(amountIn, amountProof);
        euint256 limit = Nox.fromExternal(minOut, minOutProof);

        // Escrow from the direction's input balance without revealing the direction:
        // both balances are debited symmetrically, one of them by an encrypted zero.
        euint256 zero = Nox.toEuint256(0);
        euint256 balA = _balanceOf(msg.sender, address(tokenA));
        euint256 balB = _balanceOf(msg.sender, address(tokenB));
        (ebool okA, ) = Nox.safeSub(balA, amount);
        (ebool okB, ) = Nox.safeSub(balB, amount);
        euint256 escrowA = Nox.select(direction, Nox.select(okA, amount, zero), zero);
        euint256 escrowB = Nox.select(direction, zero, Nox.select(okB, amount, zero));
        _storeBalance(msg.sender, address(tokenA), Nox.sub(balA, escrowA));
        _storeBalance(msg.sender, address(tokenB), Nox.sub(balB, escrowB));
        euint256 escrowed = Nox.add(escrowA, escrowB); // == amount, or 0 on shortfall

        // Persist handles for the lock transaction, and let the owner audit them.
        Nox.allowThis(direction);
        Nox.allowThis(escrowed);
        Nox.allowThis(limit);
        Nox.allow(escrowed, msg.sender);

        intents.push(
            Intent({
                owner: msg.sender,
                sellAForB: direction,
                amountIn: escrowed,
                minOut: limit,
                includedA: euint256.wrap(0),
                includedB: euint256.wrap(0)
            })
        );
        emit IntentSubmitted(currentEpochId, intents.length - 1, msg.sender);
    }

    // ============ Epoch lifecycle ============

    /// @notice Locks the current epoch: fixes the reference price from the pool,
    ///         performs the encrypted minOut eligibility check per intent, refunds
    ///         ineligible escrows, and requests public decryption of the two
    ///         eligible side totals. Permissionless.
    function lockEpoch() external nonReentrant {
        uint64 epochId = currentEpochId;
        Epoch storage epoch = _epochs[epochId];
        require(epoch.phase == EpochPhase.Open, EpochNotOpen());
        Intent[] storage intents = _intents[epochId];
        require(
            block.timestamp >= epoch.deadline || intents.length == maxIntentsPerEpoch,
            LockConditionsNotMet()
        );

        if (intents.length == 0) {
            // Nothing to settle: close out and roll straight to a fresh epoch.
            epoch.phase = EpochPhase.Settled;
            emit EpochSettled(epochId, 0, 0, false, 0, 0);
            _openNextEpoch();
            return;
        }

        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        (uint256 priceAtoB, uint256 priceBtoA) = VeilSwapEpochLib.spotPricesE18(sqrtPriceX96, aIsToken0);
        epoch.priceAtoBE18 = priceAtoB;
        epoch.priceBtoAE18 = priceBtoA;

        // Shared plaintext constants wrapped once as handles.
        euint256 zero = Nox.toEuint256(0);
        euint256 scale = Nox.toEuint256(VeilSwapEpochLib.PRICE_SCALE);
        euint256 worstA = Nox.toEuint256(VeilSwapEpochLib.worstPriceE18(priceAtoB, slippageBps));
        euint256 worstB = Nox.toEuint256(VeilSwapEpochLib.worstPriceE18(priceBtoA, slippageBps));

        euint256 sumA = zero;
        euint256 sumB = zero;
        for (uint256 i = 0; i < intents.length; i++) {
            Intent storage intent = intents[i];
            // Worst-case output this intent is guaranteed at settlement. The same
            // bound later caps the Uniswap swap via amountOutMinimum, so
            // eligibility here implies the realized fill respects minOut.
            euint256 rate = Nox.select(intent.sellAForB, worstA, worstB);
            euint256 worstOut = Nox.div(Nox.mul(intent.amountIn, rate), scale);
            ebool eligible = Nox.le(intent.minOut, worstOut);
            euint256 included = Nox.select(eligible, intent.amountIn, zero);
            euint256 includedA = Nox.select(intent.sellAForB, included, zero);
            euint256 includedB = Nox.sub(included, includedA);

            // Refund the excluded portion immediately (encrypted zero for eligible
            // intents — the credit pattern is uniform so nothing leaks).
            euint256 refund = Nox.sub(intent.amountIn, included);
            euint256 refundA = Nox.select(intent.sellAForB, refund, zero);
            _creditBalance(intent.owner, address(tokenA), refundA);
            _creditBalance(intent.owner, address(tokenB), Nox.sub(refund, refundA));

            sumA = Nox.add(sumA, includedA);
            sumB = Nox.add(sumB, includedB);
            Nox.allowThis(includedA);
            Nox.allowThis(includedB);
            intent.includedA = includedA;
            intent.includedB = includedB;
        }

        Nox.allowThis(sumA);
        Nox.allowThis(sumB);
        Nox.allowPublicDecryption(sumA);
        Nox.allowPublicDecryption(sumB);
        epoch.sumAIn = sumA;
        epoch.sumBIn = sumB;
        epoch.lockedAt = uint64(block.timestamp);
        epoch.phase = EpochPhase.Locked;
        emit EpochLocked(epochId, intents.length, priceAtoB, sumA, sumB);
    }

    /// @notice Settles a locked epoch: verifies the decrypted side totals on-chain,
    ///         executes ONE aggregate Uniswap swap for the net residual (if any),
    ///         and credits every participant pro-rata in the encrypted domain.
    ///         Permissionless — proofs come from the Nox SDK's `publicDecrypt`.
    function settleEpoch(bytes calldata sumAProof, bytes calldata sumBProof) external nonReentrant {
        uint64 epochId = currentEpochId;
        Epoch storage epoch = _epochs[epochId];
        require(epoch.phase == EpochPhase.Locked, EpochNotLocked());

        uint256 sumAIn = Nox.publicDecrypt(epoch.sumAIn, sumAProof);
        uint256 sumBIn = Nox.publicDecrypt(epoch.sumBIn, sumBProof);
        VeilSwapEpochLib.SettlementPlan memory plan = VeilSwapEpochLib.computeSettlement(
            sumAIn,
            sumBIn,
            epoch.priceAtoBE18
        );

        // Effects before the external swap.
        epoch.phase = EpochPhase.Settled;
        epoch.settledSumAIn = sumAIn;
        epoch.settledSumBIn = sumBIn;
        epoch.sellAResidual = plan.sellAResidual;
        epoch.residualIn = plan.residualIn;

        uint256 uniswapOut = 0;
        if (plan.residualIn > 0) {
            uniswapOut = _swapResidualOnUniswap(plan, epoch);
        }
        epoch.uniswapAmountOut = uniswapOut;

        // Pro-rata distribution over encrypted per-intent inputs:
        //   payout_i = included_i * totalOut / totalIn  (floor; dust stays in the
        //   contract — it can never make a payout exceed available funds).
        uint256 totalOutForA = plan.internalOutA + (plan.sellAResidual ? uniswapOut : 0);
        uint256 totalOutForB = plan.internalOutB + (plan.sellAResidual ? 0 : uniswapOut);
        Intent[] storage intents = _intents[epochId];
        if (sumAIn > 0) {
            euint256 hTotalOutA = Nox.toEuint256(totalOutForA);
            euint256 hSumA = Nox.toEuint256(sumAIn);
            for (uint256 i = 0; i < intents.length; i++) {
                euint256 payoutB = Nox.div(Nox.mul(intents[i].includedA, hTotalOutA), hSumA);
                _creditBalance(intents[i].owner, address(tokenB), payoutB);
            }
        }
        if (sumBIn > 0) {
            euint256 hTotalOutB = Nox.toEuint256(totalOutForB);
            euint256 hSumB = Nox.toEuint256(sumBIn);
            for (uint256 i = 0; i < intents.length; i++) {
                euint256 payoutA = Nox.div(Nox.mul(intents[i].includedB, hTotalOutB), hSumB);
                _creditBalance(intents[i].owner, address(tokenA), payoutA);
            }
        }

        emit EpochSettled(epochId, sumAIn, sumBIn, plan.sellAResidual, plan.residualIn, uniswapOut);
        _openNextEpoch();
    }

    /// @notice Escape hatch: if a locked epoch cannot settle within the grace period
    ///         (e.g. the pool moved beyond the slippage bound for too long, or the
    ///         decryption pipeline stalled), anyone can refund all batched escrows
    ///         and roll to a fresh epoch. No funds can get stuck.
    function cancelEpoch() external nonReentrant {
        uint64 epochId = currentEpochId;
        Epoch storage epoch = _epochs[epochId];
        require(epoch.phase == EpochPhase.Locked, EpochNotLocked());
        require(block.timestamp > epoch.lockedAt + cancelGracePeriod, CancelGraceNotElapsed());

        epoch.phase = EpochPhase.Cancelled;
        Intent[] storage intents = _intents[epochId];
        for (uint256 i = 0; i < intents.length; i++) {
            _creditBalance(intents[i].owner, address(tokenA), intents[i].includedA);
            _creditBalance(intents[i].owner, address(tokenB), intents[i].includedB);
        }
        emit EpochCancelled(epochId);
        _openNextEpoch();
    }

    // ============ Views (frontend + keeper) ============

    function epochStatus(
        uint64 epochId
    ) external view returns (EpochPhase phase, uint64 openedAt, uint64 deadline, uint64 lockedAt, uint256 intentCount) {
        Epoch storage epoch = _epochs[epochId];
        return (epoch.phase, epoch.openedAt, epoch.deadline, epoch.lockedAt, _intents[epochId].length);
    }

    /// @notice Encrypted side-total handles the keeper publicly decrypts after lock.
    function epochSumHandles(uint64 epochId) external view returns (euint256 sumAIn, euint256 sumBIn) {
        return (_epochs[epochId].sumAIn, _epochs[epochId].sumBIn);
    }

    function epochPrices(uint64 epochId) external view returns (uint256 priceAtoBE18, uint256 priceBtoAE18) {
        return (_epochs[epochId].priceAtoBE18, _epochs[epochId].priceBtoAE18);
    }

    function epochSettlement(
        uint64 epochId
    )
        external
        view
        returns (uint256 sumAIn, uint256 sumBIn, bool sellAResidual, uint256 residualIn, uint256 uniswapAmountOut)
    {
        Epoch storage epoch = _epochs[epochId];
        return (epoch.settledSumAIn, epoch.settledSumBIn, epoch.sellAResidual, epoch.residualIn, epoch.uniswapAmountOut);
    }

    // ============ Internals ============

    /// @dev Executes the single aggregate residual swap. `amountOutMinimum` uses the
    ///      same worst-case bound as the eligibility check in {lockEpoch}, which is
    ///      exactly what guarantees every included intent's minOut at execution.
    function _swapResidualOnUniswap(
        VeilSwapEpochLib.SettlementPlan memory plan,
        Epoch storage epoch
    ) private returns (uint256 amountOut) {
        (IERC20 tokenIn, IERC20 tokenOut, uint256 priceE18) = plan.sellAResidual
            ? (tokenA, tokenB, epoch.priceAtoBE18)
            : (tokenB, tokenA, epoch.priceBtoAE18);
        uint256 minimumOut = VeilSwapEpochLib.worstCaseOut(plan.residualIn, priceE18, slippageBps);

        tokenIn.forceApprove(address(router), plan.residualIn);
        amountOut = router.exactInputSingle(
            ISwapRouter02Minimal.ExactInputSingleParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                fee: poolFee,
                recipient: address(this),
                amountIn: plan.residualIn,
                amountOutMinimum: minimumOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _openNextEpoch() private {
        currentEpochId += 1;
        Epoch storage epoch = _epochs[currentEpochId];
        epoch.phase = EpochPhase.Open;
        epoch.openedAt = uint64(block.timestamp);
        epoch.deadline = uint64(block.timestamp) + epochDuration;
        emit EpochOpened(currentEpochId, epoch.deadline);
    }
}
