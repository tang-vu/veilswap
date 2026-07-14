// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/// @title VeilSwapBalances
/// @notice Encrypted internal ledger for the two pair tokens. Once deposited, a
///         user's balance lives as an encrypted Nox handle: amounts of transfers,
///         swap intents and internal fills are never visible on-chain.
///
///         Privacy boundaries (by construction, documented honestly):
///           - Deposit amounts are public (ERC-20 transfer in).
///           - Withdrawal amounts become public at finalization (ERC-20 transfer out),
///             but the recipient can be ANY address, severing the deposit link.
///           - Confidential transfer amounts are hidden; participant addresses are not
///             (Nox has no encrypted address type).
abstract contract VeilSwapBalances is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;

    /// @dev Per-deposit cap. Keeps every encrypted balance far below the range where
    ///      the settlement math (balance * priceE18) could wrap in euint256 arithmetic,
    ///      assuming supported tokens have a total supply below 2^128.
    uint256 public constant DEPOSIT_CAP = 1 << 128;

    /// @dev user => token => encrypted balance handle.
    mapping(address => mapping(address => euint256)) private _balances;

    struct WithdrawRequest {
        address to;
        address token;
    }

    /// @dev Burn-result handle => pending withdrawal. Handles are unique per operation
    ///      (deterministic hash over op, inputs, tx context), so they are safe keys —
    ///      same assumption the official ERC20ToERC7984Wrapper makes.
    mapping(euint256 => WithdrawRequest) private _withdrawRequests;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event WithdrawRequested(address indexed user, address indexed token, address to, euint256 requestId);
    event WithdrawFinalized(address indexed to, address indexed token, uint256 amount, euint256 requestId);
    /// @dev Intentionally carries no amount: that is the point.
    event ConfidentialTransfer(address indexed from, address indexed to, address indexed token);

    error UnsupportedToken(address token);
    error DepositTooLarge(uint256 amount);
    error InvalidRecipient(address to);
    error InvalidWithdrawRequest();

    constructor(IERC20 tokenA_, IERC20 tokenB_) {
        tokenA = tokenA_;
        tokenB = tokenB_;
    }

    modifier onlySupportedToken(address token) {
        require(token == address(tokenA) || token == address(tokenB), UnsupportedToken(token));
        _;
    }

    // ============ Deposit ============

    /// @notice Deposits `amount` of a pair token; the credited balance is encrypted.
    /// @dev Overflow-free without safeAdd: a user's balance is bounded by the contract's
    ///      total holdings, which are bounded by the token's total supply (< 2^128 per
    ///      the DEPOSIT_CAP assumption), far below the euint256 wrap boundary.
    function deposit(address token, uint256 amount) external nonReentrant onlySupportedToken(token) {
        require(amount <= DEPOSIT_CAP, DepositTooLarge(amount));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        euint256 newBalance = Nox.add(_balanceOf(msg.sender, token), Nox.toEuint256(amount));
        _storeBalance(msg.sender, token, newBalance);
        emit Deposited(msg.sender, token, amount);
    }

    // ============ Confidential transfer ============

    /// @notice Transfers an encrypted amount to `to` inside the ledger. All-or-nothing:
    ///         if the sender's balance is insufficient, nothing moves and the
    ///         transaction still succeeds, so outcomes never leak through reverts.
    ///         Only the sender can learn whether it went through (encrypted `ok`).
    function confidentialTransfer(
        address to,
        address token,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlySupportedToken(token) {
        require(to != address(0) && to != msg.sender, InvalidRecipient(to));
        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        (ebool ok, euint256 newFrom, euint256 newTo) = Nox.transfer(
            _balanceOf(msg.sender, token),
            _balanceOf(to, token),
            amount
        );
        _storeBalance(msg.sender, token, newFrom);
        _storeBalance(to, token, newTo);
        Nox.allow(ok, msg.sender);
        emit ConfidentialTransfer(msg.sender, to, token);
    }

    // ============ Withdraw (two-step) ============

    /// @notice Step 1: burns an encrypted amount from the caller's balance and marks the
    ///         burnt amount publicly decryptable. Insufficient balance burns 0 instead of
    ///         reverting (no balance oracle). `to` may be any address — including a fresh
    ///         one — which is what breaks the deposit -> withdraw link.
    /// @return requestId Handle to pass to {finalizeWithdraw} together with the
    ///         decryption proof obtained from the Nox SDK's `publicDecrypt`.
    function requestWithdraw(
        address token,
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlySupportedToken(token) returns (euint256 requestId) {
        require(to != address(0), InvalidRecipient(to));
        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        euint256 balance = _balanceOf(msg.sender, token);
        (ebool ok, euint256 debited) = Nox.safeSub(balance, amount);
        euint256 withdrawn = Nox.select(ok, amount, Nox.toEuint256(0));
        euint256 newBalance = Nox.select(ok, debited, balance);
        _storeBalance(msg.sender, token, newBalance);
        Nox.allowThis(withdrawn);
        Nox.allowPublicDecryption(withdrawn);

        requestId = withdrawn;
        assert(_withdrawRequests[requestId].to == address(0)); // handle uniqueness
        _withdrawRequests[requestId] = WithdrawRequest({to: to, token: token});
        emit WithdrawRequested(msg.sender, token, to, requestId);
    }

    /// @notice Step 2: verifies the public-decryption proof on-chain and releases the
    ///         plaintext amount to the recorded recipient. Callable by anyone holding
    ///         the proof (the recipient does not need the requester's key).
    function finalizeWithdraw(euint256 requestId, bytes calldata decryptionProof) external nonReentrant {
        WithdrawRequest memory request = _withdrawRequests[requestId];
        require(request.to != address(0), InvalidWithdrawRequest());
        delete _withdrawRequests[requestId];
        uint256 amount = Nox.publicDecrypt(requestId, decryptionProof);
        IERC20(request.token).safeTransfer(request.to, amount);
        emit WithdrawFinalized(request.to, request.token, amount, requestId);
    }

    // ============ Views ============

    /// @notice Returns the caller-facing encrypted balance handle (decryptable only by
    ///         its owner through the Nox SDK; zero handle if never touched).
    function balanceHandle(address user, address token) external view returns (euint256) {
        return _balances[user][token];
    }

    // ============ Internal ledger helpers ============

    /// @dev Reads a balance, lazily initializing first-touch balances to encrypted 0 so
    ///      every Nox op always receives a valid handle.
    function _balanceOf(address user, address token) internal returns (euint256 balance) {
        balance = _balances[user][token];
        if (!Nox.isInitialized(balance)) {
            balance = Nox.toEuint256(0);
            _balances[user][token] = balance;
            Nox.allowThis(balance);
            Nox.allow(balance, user);
        }
    }

    /// @dev Persists a new balance handle and re-grants access — required after EVERY
    ///      Nox operation, otherwise the handle is unusable in later transactions.
    function _storeBalance(address user, address token, euint256 newBalance) internal {
        _balances[user][token] = newBalance;
        Nox.allowThis(newBalance);
        Nox.allow(newBalance, user);
    }

    /// @dev Credits an encrypted amount (possibly encrypted zero) to a balance.
    ///      Used by settlement for refunds and pro-rata payouts.
    function _creditBalance(address user, address token, euint256 amount) internal {
        _storeBalance(user, token, Nox.add(_balanceOf(user, token), amount));
    }
}
