// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDelegatedWallet {
    function execute(address implementation, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = implementation.delegatecall(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }
}
