// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BatchExecutor - shipping contract for EIP-7702 delegation
/// @notice When delegated to via EIP-7702, this contract runs in the context
///         of the user's EOA. msg.sender == address(this) == the delegated EOA
///         throughout `execute`. The `onlySelf` modifier enforces that only the
///         delegated EOA can invoke the batch.
/// @dev Minimal-surface design: no admin, no upgrade, no balance held between calls.
contract BatchExecutor is ReentrancyGuard {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    error CallFailed(uint256 index, bytes reason);
    error EmptyBatch();
    error OnlySelfDelegated();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelfDelegated();
        _;
    }

    function execute(Call[] calldata calls) external payable nonReentrant onlySelf {
        uint256 len = calls.length;
        if (len == 0) revert EmptyBatch();

        for (uint256 i = 0; i < len; ++i) {
            (bool ok, bytes memory result) = calls[i].target.call{
                value: calls[i].value
            }(calls[i].data);
            if (!ok) revert CallFailed(i, result);
        }
    }
}
