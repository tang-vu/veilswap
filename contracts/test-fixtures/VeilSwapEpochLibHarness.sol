// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeilSwapEpochLib} from "../libraries/VeilSwapEpochLib.sol";

/// @title VeilSwapEpochLibHarness
/// @notice Exposes the internal pure functions of {VeilSwapEpochLib} so the netting
///         math can be exhaustively unit-tested without the TEE stack.
contract VeilSwapEpochLibHarness {
    function spotPricesE18(
        uint160 sqrtPriceX96,
        bool aIsToken0
    ) external pure returns (uint256 aToBE18, uint256 bToAE18) {
        return VeilSwapEpochLib.spotPricesE18(sqrtPriceX96, aIsToken0);
    }

    function worstPriceE18(uint256 priceE18, uint256 slippageBps) external pure returns (uint256) {
        return VeilSwapEpochLib.worstPriceE18(priceE18, slippageBps);
    }

    function worstCaseOut(
        uint256 amountIn,
        uint256 priceE18,
        uint256 slippageBps
    ) external pure returns (uint256) {
        return VeilSwapEpochLib.worstCaseOut(amountIn, priceE18, slippageBps);
    }

    function computeSettlement(
        uint256 sumAIn,
        uint256 sumBIn,
        uint256 priceAtoBE18
    ) external pure returns (VeilSwapEpochLib.SettlementPlan memory) {
        return VeilSwapEpochLib.computeSettlement(sumAIn, sumBIn, priceAtoBE18);
    }
}
