// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PrivateChatRegistry
 * @notice L1 helper for Dark Forest private chat: pins Aztec contract identity,
 *         optional labeled address registry, and refundable contact fee bonds.
 *         Does NOT store chat plaintext or encryption keys.
 */
contract PrivateChatRegistry is Ownable, ReentrancyGuard {
    struct Pin {
        bytes32 aztecChatContractAddress;
        bytes32 aztecContractClassId;
        bytes32 aztecNetworkId;
        uint64 updatedAt;
    }

    Pin public pin;

    /// @dev label => aztec address (or other opaque 32-byte id)
    mapping(bytes32 => bytes32) public addressRegistry;

    /// @dev depositor => bond balance (wei)
    mapping(address => uint256) public bonds;

    uint256 public minBondWei;

    error ZeroValue();
    error InsufficientBond();
    error NoBond();

    event ChatPinUpdated(
        bytes32 indexed aztecChatContractAddress,
        bytes32 indexed aztecContractClassId,
        bytes32 aztecNetworkId,
        uint64 updatedAt
    );
    event AddressRegistered(bytes32 indexed label, bytes32 aztecAddress);
    event BondDeposited(address indexed account, uint256 amount, uint256 newBalance);
    event BondRefunded(address indexed account, uint256 amount);
    event BondSlashed(address indexed account, address indexed to, uint256 amount);

    constructor(address initialOwner, uint256 minBondWei_) Ownable(initialOwner) {
        minBondWei = minBondWei_;
    }

    function setMinBondWei(uint256 minBondWei_) external onlyOwner {
        minBondWei = minBondWei_;
    }

    function setChatPin(
        bytes32 aztecChatContractAddress,
        bytes32 aztecContractClassId,
        bytes32 aztecNetworkId
    ) external onlyOwner {
        pin = Pin({
            aztecChatContractAddress: aztecChatContractAddress,
            aztecContractClassId: aztecContractClassId,
            aztecNetworkId: aztecNetworkId,
            updatedAt: uint64(block.timestamp)
        });
        emit ChatPinUpdated(
            aztecChatContractAddress, aztecContractClassId, aztecNetworkId, uint64(block.timestamp)
        );
    }

    function registerAddress(bytes32 label, bytes32 aztecAddress) external onlyOwner {
        if (label == bytes32(0) || aztecAddress == bytes32(0)) revert ZeroValue();
        addressRegistry[label] = aztecAddress;
        emit AddressRegistered(label, aztecAddress);
    }

    /**
     * @notice Permissionless room registration. Anyone may register when their bond
     *         balance is >= minBondWei (0 = free, used on local Anvil).
     * @dev Labels: keccak256("pc:" || ownerAztec) or keccak256("proom:" || roomHash).
     */
    function registerRoom(bytes32 label, bytes32 aztecAddress) external {
        if (label == bytes32(0) || aztecAddress == bytes32(0)) revert ZeroValue();
        if (minBondWei > 0 && bonds[msg.sender] < minBondWei) revert InsufficientBond();
        addressRegistry[label] = aztecAddress;
        emit AddressRegistered(label, aztecAddress);
    }

    function depositBond() external payable nonReentrant {
        if (msg.value == 0) revert ZeroValue();
        bonds[msg.sender] += msg.value;
        emit BondDeposited(msg.sender, msg.value, bonds[msg.sender]);
    }

    /// @notice Caller may refund their own bond when above the minimum reserve (if any).
    function refundBond(uint256 amount) external nonReentrant {
        uint256 bal = bonds[msg.sender];
        if (bal == 0) revert NoBond();
        if (amount == 0 || amount > bal) revert InsufficientBond();
        uint256 remaining = bal - amount;
        if (remaining > 0 && remaining < minBondWei) revert InsufficientBond();
        bonds[msg.sender] = remaining;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "refund failed");
        emit BondRefunded(msg.sender, amount);
    }

    /// @notice Owner may slash a hostile bond to treasury (anti-spam).
    function slashBond(address account, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroValue();
        uint256 bal = bonds[account];
        if (amount == 0 || amount > bal) revert InsufficientBond();
        bonds[account] = bal - amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "slash transfer failed");
        emit BondSlashed(account, to, amount);
    }

    function getPin()
        external
        view
        returns (
            bytes32 aztecChatContractAddress,
            bytes32 aztecContractClassId,
            bytes32 aztecNetworkId,
            uint64 updatedAt
        )
    {
        Pin memory p = pin;
        return (p.aztecChatContractAddress, p.aztecContractClassId, p.aztecNetworkId, p.updatedAt);
    }
}
