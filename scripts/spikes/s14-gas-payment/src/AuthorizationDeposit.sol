// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IAuthorizationUSDC {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice S14 experiment only. Not an audited or production deposit contract.
/// @dev The authorization nonce commits to the split and destination so a relayer
/// cannot alter them. receiveWithAuthorization prevents consuming the signature
/// outside this atomic receive-and-split call. A real integration must bind the
/// destination to the host's issued deposit address and explain the split in UI.
contract AuthorizationDeposit {
    IAuthorizationUSDC public immutable usdc;
    address public immutable feeRecipient;

    constructor(IAuthorizationUSDC token, address fees) {
        usdc = token;
        feeRecipient = fees;
    }

    function deposit(
        address payer,
        address destination,
        uint256 principal,
        uint256 fee,
        bytes32 salt,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(principal > 0, "zero principal");
        bytes32 nonce = keccak256(abi.encode(destination, principal, fee, salt));
        usdc.receiveWithAuthorization(payer, address(this), principal + fee, validAfter, validBefore, nonce, v, r, s);
        require(usdc.transfer(destination, principal), "principal failed");
        if (fee != 0) require(usdc.transfer(feeRecipient, fee), "fee failed");
    }
}
