// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CopByAgentRegistry {
    struct Session {
        address agent;
        uint64 expiresAt;
        bytes32 sessionId;
        uint256 maxCopmTrade;
        uint256 maxUsdtTrade;
        uint256 maxCopmVolume;
        uint256 maxUsdtVolume;
        uint256 usedCopmVolume;
        uint256 usedUsdtVolume;
    }

    address public immutable copm;
    address public immutable usdt;
    uint256 public totalTrades;

    mapping(address user => Session session) public sessions;
    mapping(bytes32 intentId => bool used) public usedIntents;

    event AgentSessionStarted(
        address indexed user,
        address indexed agent,
        bytes32 indexed sessionId,
        uint64 expiresAt,
        uint256 maxCopmTrade,
        uint256 maxUsdtTrade,
        uint256 maxCopmVolume,
        uint256 maxUsdtVolume
    );
    event AgentSessionRevoked(
        address indexed user,
        address indexed agent,
        bytes32 indexed sessionId
    );
    event AgentTradeConsumed(
        address indexed user,
        address indexed agent,
        bytes32 indexed sessionId,
        bytes32 intentId,
        address tokenIn,
        uint256 amountIn,
        uint256 tradeNumber
    );

    error ActiveSessionExists();
    error ExpiredSession();
    error InvalidAgent();
    error InvalidAmount();
    error InvalidSession();
    error InvalidTokenPair();
    error InvalidUser();
    error IntentAlreadyUsed();
    error NotSessionParty();
    error OnlyUserWallet();
    error SameToken();
    error SessionVolumeExceeded();
    error TradeAmountExceeded();
    error ZeroAddress();
    error ZeroLimit();
    error ZeroSessionId();

    constructor(address copm_, address usdt_) {
        if (copm_ == address(0) || usdt_ == address(0)) revert ZeroAddress();
        if (copm_ == usdt_) revert SameToken();
        copm = copm_;
        usdt = usdt_;
    }

    function startSession(
        address user,
        address agent,
        bytes32 sessionId,
        uint64 expiresAt,
        uint256 maxCopmTrade,
        uint256 maxUsdtTrade,
        uint256 maxCopmVolume,
        uint256 maxUsdtVolume
    ) external {
        if (user == address(0) || agent == address(0)) revert ZeroAddress();
        if (sessionId == bytes32(0)) revert ZeroSessionId();
        if (expiresAt <= block.timestamp) revert ExpiredSession();
        if (
            maxCopmTrade == 0 ||
            maxUsdtTrade == 0 ||
            maxCopmVolume == 0 ||
            maxUsdtVolume == 0
        ) revert ZeroLimit();

        Session memory current = sessions[user];
        if (current.expiresAt > block.timestamp) revert ActiveSessionExists();

        sessions[user] = Session({
            agent: agent,
            expiresAt: expiresAt,
            sessionId: sessionId,
            maxCopmTrade: maxCopmTrade,
            maxUsdtTrade: maxUsdtTrade,
            maxCopmVolume: maxCopmVolume,
            maxUsdtVolume: maxUsdtVolume,
            usedCopmVolume: 0,
            usedUsdtVolume: 0
        });

        emit AgentSessionStarted(
            user,
            agent,
            sessionId,
            expiresAt,
            maxCopmTrade,
            maxUsdtTrade,
            maxCopmVolume,
            maxUsdtVolume
        );
    }

    function revokeSession(address user) external {
        Session memory current = sessions[user];
        if (current.sessionId == bytes32(0)) revert InvalidSession();
        if (msg.sender != user && msg.sender != current.agent) {
            revert NotSessionParty();
        }

        delete sessions[user];
        emit AgentSessionRevoked(user, current.agent, current.sessionId);
    }

    function validateAndConsumeTrade(
        address user,
        address agent,
        bytes32 sessionId,
        bytes32 intentId,
        address tokenIn,
        uint256 amountIn
    ) external returns (uint256 tradeNumber) {
        if (msg.sender != user) revert OnlyUserWallet();
        if (user == address(0)) revert InvalidUser();
        if (agent == address(0)) revert InvalidAgent();
        if (sessionId == bytes32(0)) revert ZeroSessionId();
        if (intentId == bytes32(0)) revert ZeroSessionId();
        if (amountIn == 0) revert InvalidAmount();
        if (usedIntents[intentId]) revert IntentAlreadyUsed();
        if (tokenIn != copm && tokenIn != usdt) revert InvalidTokenPair();

        Session storage current = sessions[user];
        if (current.sessionId != sessionId) revert InvalidSession();
        if (current.agent != agent) revert InvalidAgent();
        if (current.expiresAt <= block.timestamp) revert ExpiredSession();

        if (tokenIn == copm) {
            if (amountIn > current.maxCopmTrade) revert TradeAmountExceeded();
            if (current.usedCopmVolume + amountIn > current.maxCopmVolume) {
                revert SessionVolumeExceeded();
            }
            current.usedCopmVolume += amountIn;
        } else {
            if (amountIn > current.maxUsdtTrade) revert TradeAmountExceeded();
            if (current.usedUsdtVolume + amountIn > current.maxUsdtVolume) {
                revert SessionVolumeExceeded();
            }
            current.usedUsdtVolume += amountIn;
        }

        usedIntents[intentId] = true;
        tradeNumber = ++totalTrades;

        emit AgentTradeConsumed(
            user,
            agent,
            sessionId,
            intentId,
            tokenIn,
            amountIn,
            tradeNumber
        );
    }

    function isSessionActive(address user, address agent) external view returns (bool) {
        Session memory current = sessions[user];
        return current.agent == agent && current.expiresAt > block.timestamp;
    }
}
