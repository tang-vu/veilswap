// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISwapRouter02Minimal
/// @notice Minimal interface for Uniswap V3 SwapRouter02, restricted to the single
///         function VeilSwap needs. SwapRouter02 (unlike the original ISwapRouter)
///         has no `deadline` field inside the params struct.
interface ISwapRouter02Minimal {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another token.
    /// @return amountOut The amount of the received token.
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}
