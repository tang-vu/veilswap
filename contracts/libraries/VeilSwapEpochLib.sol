// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title VeilSwapEpochLib
/// @notice Pure plaintext math for VeilSwap epoch settlement: pool price conversion,
///         slippage bounds, and the internal-netting split. Kept free of encrypted
///         types so every branch is unit-testable without the TEE stack.
library VeilSwapEpochLib {
    /// @dev All prices are expressed in raw token units scaled by 1e18:
    ///      `amountOutRaw = amountInRaw * priceE18 / PRICE_SCALE`.
    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @dev sqrtPriceX96 >= 2^128 would overflow `sp * sp`; unreachable for sanely
    ///      priced pairs (would imply a token1/token0 raw ratio above ~1.2e57).
    error SqrtPriceOverflow();
    /// @dev Slippage of 100% or more makes the worst-case bound meaningless.
    error InvalidSlippage();

    /// @notice Result of netting the two eligible sides of an epoch at the lock price.
    /// @param sellAResidual  Direction of the residual Uniswap swap (true = tokenA in).
    /// @param residualIn     Input amount for the residual swap; 0 means fully netted.
    /// @param internalOutA   tokenB owed to the A-side from internal matching.
    /// @param internalOutB   tokenA owed to the B-side from internal matching.
    struct SettlementPlan {
        bool sellAResidual;
        uint256 residualIn;
        uint256 internalOutA;
        uint256 internalOutB;
    }

    /// @notice Converts a pool's sqrtPriceX96 into both spot prices, scaled by 1e18.
    /// @param sqrtPriceX96 Current pool sqrt price (Q64.96, sqrt(token1/token0)).
    /// @param aIsToken0    Whether VeilSwap's tokenA is the pool's token0.
    /// @return aToBE18 Raw tokenB units received per raw tokenA unit, scaled 1e18.
    /// @return bToAE18 Raw tokenA units received per raw tokenB unit, scaled 1e18.
    function spotPricesE18(
        uint160 sqrtPriceX96,
        bool aIsToken0
    ) internal pure returns (uint256 aToBE18, uint256 bToAE18) {
        uint256 sp = uint256(sqrtPriceX96);
        require(sp < type(uint128).max, SqrtPriceOverflow());
        // token1 per token0 in Q192 fixed point.
        uint256 priceX192 = sp * sp;
        // Math.mulDiv performs full 512-bit intermediate math, so neither product
        // below can overflow; priceX192 == 0 reverts (malformed/uninitialized pool).
        uint256 oneFor0E18 = Math.mulDiv(priceX192, PRICE_SCALE, 1 << 192);
        uint256 zeroFor1E18 = Math.mulDiv(1 << 192, PRICE_SCALE, priceX192);
        (aToBE18, bToAE18) = aIsToken0 ? (oneFor0E18, zeroFor1E18) : (zeroFor1E18, oneFor0E18);
    }

    /// @notice Applies a downward slippage tolerance to a price.
    function worstPriceE18(uint256 priceE18, uint256 slippageBps) internal pure returns (uint256) {
        require(slippageBps < BPS, InvalidSlippage());
        return (priceE18 * (BPS - slippageBps)) / BPS;
    }

    /// @notice Worst-case output for a given input at a slippage-adjusted price.
    ///         This is the exact bound used both for encrypted per-intent eligibility
    ///         and for the aggregate swap's `amountOutMinimum`, which is what makes
    ///         the per-intent minOut guarantee carry through to execution.
    function worstCaseOut(
        uint256 amountIn,
        uint256 priceE18,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        return Math.mulDiv(amountIn, worstPriceE18(priceE18, slippageBps), PRICE_SCALE);
    }

    /// @notice Nets the two eligible side totals at the lock-time price and sizes the
    ///         residual Uniswap swap. Exact integer math; every floor keeps the
    ///         contract solvent (rounding dust accrues to the contract, never to users'
    ///         detriment beyond 1 wei collectively per side).
    ///
    ///         Invariants (verified in tests):
    ///           tokenA out = internalOutB + (sellAResidual ? residualIn : 0)  == sumAIn (when A is larger side)
    ///           tokenB out = internalOutA + (sellAResidual ? 0 : residualIn)  == sumBIn (when B is larger side)
    /// @param sumAIn       Decrypted eligible tokenA input total (A -> B intents).
    /// @param sumBIn       Decrypted eligible tokenB input total (B -> A intents).
    /// @param priceAtoBE18 Lock-time spot price (tokenB per tokenA, 1e18-scaled).
    function computeSettlement(
        uint256 sumAIn,
        uint256 sumBIn,
        uint256 priceAtoBE18
    ) internal pure returns (SettlementPlan memory plan) {
        // Value of the entire A side expressed in tokenB at the lock price.
        uint256 aInB = Math.mulDiv(sumAIn, priceAtoBE18, PRICE_SCALE);
        if (aInB <= sumBIn) {
            // The A side is fully matched internally; the B-side surplus is sold on
            // Uniswap (tokenB -> tokenA). A-side receives exactly its tokenB value,
            // B-side receives all of A's tokenA plus the Uniswap output.
            plan.sellAResidual = false;
            plan.residualIn = sumBIn - aInB;
            plan.internalOutA = aInB;
            plan.internalOutB = sumAIn;
        } else {
            // The B side is fully matched internally; the A-side surplus is sold on
            // Uniswap (tokenA -> tokenB). B-side receives its tokenA value, A-side
            // receives all of B's tokenB plus the Uniswap output.
            uint256 bInA = Math.mulDiv(sumBIn, PRICE_SCALE, priceAtoBE18);
            plan.sellAResidual = true;
            plan.residualIn = sumAIn - bInA;
            plan.internalOutA = sumBIn;
            plan.internalOutB = bInA;
        }
    }
}
