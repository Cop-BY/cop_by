// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockFXRouter {
    event Swapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        address recipient,
        uint256 amountIn,
        uint256 amountOut
    );

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
        emit Swapped(msg.sender, tokenIn, tokenOut, recipient, amountIn, amountOut);
    }

    function drainExtra(address tokenIn, uint256 amount) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
    }

    function fail() external pure {
        revert("mock swap failed");
    }
}
