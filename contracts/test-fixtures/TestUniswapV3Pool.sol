// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TestUniswapV3Pool
/// @notice Minimal stand-in for a Uniswap V3 pool exposing only what VeilSwap
///         reads (token ordering + slot0 price). Local-chain test fixture only.
contract TestUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint160 public sqrtPriceX96;

    constructor(address token0_, address token1_, uint160 sqrtPriceX96_) {
        token0 = token0_;
        token1 = token1_;
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function setSqrtPriceX96(uint160 newSqrtPriceX96) external {
        sqrtPriceX96 = newSqrtPriceX96;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}
