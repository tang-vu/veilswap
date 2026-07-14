// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IUniswapV3PoolMinimal
/// @notice Minimal read-only interface of a Uniswap V3 pool, used to source the
///         epoch reference price and to bind token ordering at deployment.
interface IUniswapV3PoolMinimal {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);

    function token1() external view returns (address);
}
