// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICopByAgentRegistry {
    function validateAndConsumeTrade(
        address user,
        address agent,
        bytes32 sessionId,
        bytes32 intentId,
        address tokenIn,
        uint256 amountIn
    ) external returns (uint256 tradeNumber);
}

contract CopByFXExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable registry;
    address public immutable copm;
    address public immutable usdt;

    event AgentTradeExecuted(
        address indexed user,
        address indexed agent,
        bytes32 indexed sessionId,
        bytes32 intentId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    error DeadlineExpired();
    error InvalidAmount();
    error InvalidTokenPair();
    error SameToken();
    error SlippageExceeded();
    error TokenInputExceeded();
    error ZeroAddress();
    error ZeroSessionId();

    constructor(address registry_, address copm_, address usdt_) {
        if (registry_ == address(0) || copm_ == address(0) || usdt_ == address(0)) {
            revert ZeroAddress();
        }
        if (copm_ == usdt_) revert SameToken();

        registry = registry_;
        copm = copm_;
        usdt = usdt_;
    }

    function executeTrade(
        bytes32 sessionId,
        bytes32 intentId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapData,
        uint256 deadline
    ) external nonReentrant {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (sessionId == bytes32(0) || intentId == bytes32(0)) revert ZeroSessionId();
        if (amountIn == 0 || minAmountOut == 0) revert InvalidAmount();
        if (swapTarget == address(0)) revert ZeroAddress();
        if (tokenIn != copm && tokenIn != usdt) revert InvalidTokenPair();

        address tokenOut = tokenIn == copm ? usdt : copm;
        ICopByAgentRegistry(registry).validateAndConsumeTrade(
            address(this),
            msg.sender,
            sessionId,
            intentId,
            tokenIn,
            amountIn
        );

        uint256 amountOut = _swapExactInput(
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            swapTarget,
            swapData
        );

        emit AgentTradeExecuted(
            address(this),
            msg.sender,
            sessionId,
            intentId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }

    function _swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapData
    ) private returns (uint256 amountOut) {
        IERC20 input = IERC20(tokenIn);
        IERC20 output = IERC20(tokenOut);
        uint256 inputBefore = input.balanceOf(address(this));
        uint256 outputBefore = output.balanceOf(address(this));

        input.forceApprove(swapTarget, 0);
        input.forceApprove(swapTarget, amountIn);
        (bool ok, bytes memory result) = swapTarget.call(swapData);
        input.forceApprove(swapTarget, 0);

        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }

        uint256 inputAfter = input.balanceOf(address(this));
        uint256 outputAfter = output.balanceOf(address(this));
        if (inputBefore > inputAfter && inputBefore - inputAfter > amountIn) {
            revert TokenInputExceeded();
        }

        amountOut = outputAfter - outputBefore;
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }
}
