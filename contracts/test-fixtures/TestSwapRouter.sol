// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02Minimal} from "../interfaces/ISwapRouter02Minimal.sol";

/// @title TestSwapRouter
/// @notice Deterministic SwapRouter02 stand-in for local tests: fills exactInputSingle
///         at a settable price from its own inventory and enforces amountOutMinimum
///         with the real router's semantics. Local-chain test fixture only.
contract TestSwapRouter is ISwapRouter02Minimal {
    using SafeERC20 for IERC20;

    /// @dev tokenIn => tokenOut => output units per input unit, scaled 1e18.
    mapping(address => mapping(address => uint256)) public priceE18;

    uint256 public callCount;

    error TooLittleReceived();

    function setPriceE18(address tokenIn, address tokenOut, uint256 newPriceE18) external {
        priceE18[tokenIn][tokenOut] = newPriceE18;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        amountOut = (params.amountIn * priceE18[params.tokenIn][params.tokenOut]) / 1e18;
        // Mirrors the real router's slippage check ("Too little received").
        require(amountOut >= params.amountOutMinimum, TooLittleReceived());
        callCount += 1;
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
