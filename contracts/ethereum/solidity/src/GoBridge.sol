// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFeeAssetHandler {
    function mint(address _recipient) external;
    function mintAmount() external view returns (uint256);
}

interface IFeeJuicePortal {
    function depositToAztecPublic(
        bytes32 _to,
        uint256 _amount,
        bytes32 _secretHash
    ) external returns (bytes32, uint256);
}

/**
 * @title GoBridge
 * @notice Atomic multi-bridge helper bound to immutable trusted Fee Juice, portal, and optional faucet.
 *         Skims a protocol fee (BPS) to an immutable ETH fee recipient on every user-funded bridge.
 */
contract GoBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable feeJuice;
    IFeeJuicePortal public immutable portal;
    /// @dev address(0) disables mint paths (mainnet / no faucet).
    IFeeAssetHandler public immutable feeAssetHandler;
    address public immutable rescueBeneficiary;
    /// @dev Anonymous Trezor / treasury that receives the protocol fee on L1.
    address public immutable feeRecipient;

    error LengthMismatch();
    error ZeroAddress();
    error FaucetDisabled();
    error ZeroAmount();
    error FeeExceedsAmount();

    event ProtocolFeePaid(address indexed payer, address indexed recipient, uint256 feeAmount, uint256 netBridged);
    event EthServiceFeePaid(address indexed payer, address indexed recipient, uint256 amount);

    constructor(
        address feeJuice_,
        address portal_,
        address feeAssetHandler_,
        address rescueBeneficiary_,
        address feeRecipient_
    ) {
        if (
            feeJuice_ == address(0) || portal_ == address(0) || rescueBeneficiary_ == address(0)
                || feeRecipient_ == address(0)
        ) {
            revert ZeroAddress();
        }
        feeJuice = IERC20(feeJuice_);
        portal = IFeeJuicePortal(portal_);
        feeAssetHandler = IFeeAssetHandler(feeAssetHandler_);
        rescueBeneficiary = rescueBeneficiary_;
        feeRecipient = feeRecipient_;
    }

    function mintAndBridgeMultiple(
        bytes32[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata secretHashes
    ) external nonReentrant {
        if (address(feeAssetHandler) == address(0)) revert FaucetDisabled();
        if (recipients.length != amounts.length || amounts.length != secretHashes.length) {
            revert LengthMismatch();
        }

        uint256 totalNeeded = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroAmount();
            totalNeeded += amounts[i];
        }

        _mintAtLeast(totalNeeded);
        _approvePortal(totalNeeded);

        for (uint256 i = 0; i < recipients.length; i++) {
            portal.depositToAztecPublic(recipients[i], amounts[i], secretHashes[i]);
        }

        _clearPortalAllowance();
        _refundSurplus();
    }

    function bridgeMultiple(
        bytes32[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata secretHashes
    ) external nonReentrant {
        if (recipients.length != amounts.length || amounts.length != secretHashes.length) {
            revert LengthMismatch();
        }

        uint256 totalGross = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroAmount();
            totalGross += amounts[i];
        }

        (uint256 totalFee, uint256 netTotal) = _splitFee(totalGross);
        if (netTotal == 0) revert FeeExceedsAmount();

        feeJuice.safeTransferFrom(msg.sender, address(this), totalGross);
        if (totalFee > 0) {
            feeJuice.safeTransfer(feeRecipient, totalFee);
            emit ProtocolFeePaid(msg.sender, feeRecipient, totalFee, netTotal);
        }

        // Deposit each leg's net share: floor(amount * netTotal / totalGross) with dust on last.
        uint256 deposited;
        _approvePortal(netTotal);
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 netI;
            if (i + 1 == recipients.length) {
                netI = netTotal - deposited;
            } else {
                netI = (amounts[i] * netTotal) / totalGross;
                deposited += netI;
            }
            if (netI == 0) revert ZeroAmount();
            portal.depositToAztecPublic(recipients[i], netI, secretHashes[i]);
        }
        _clearPortalAllowance();
    }

    function mintAndBridge(bytes32 to, uint256 amount, bytes32 secretHash) external payable nonReentrant {
        if (address(feeAssetHandler) == address(0)) revert FaucetDisabled();
        if (amount == 0) revert ZeroAmount();

        _forwardEthServiceFee();

        // Faucet path: mint gross, deposit net, send fee to recipient (no user pull).
        (uint256 fee, uint256 net) = _splitFee(amount);
        _mintAtLeast(amount);
        _approvePortal(net);
        portal.depositToAztecPublic(to, net, secretHash);
        _clearPortalAllowance();
        if (fee > 0) {
            feeJuice.safeTransfer(feeRecipient, fee);
            emit ProtocolFeePaid(msg.sender, feeRecipient, fee, net);
        }
        _refundSurplus();
    }

    /**
     * @notice User-funded single bridge. `amount` is the gross L1 spend;
     *         5% goes to `feeRecipient`, 95% is deposited to Aztec.
     *         Optional `msg.value` is forwarded to `feeRecipient` (mainnet ETH service fee).
     */
    function bridge(bytes32 to, uint256 amount, bytes32 secretHash) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();
        (uint256 fee, uint256 net) = _splitFee(amount);
        if (net == 0) revert FeeExceedsAmount();

        _forwardEthServiceFee();

        feeJuice.safeTransferFrom(msg.sender, address(this), amount);
        if (fee > 0) {
            feeJuice.safeTransfer(feeRecipient, fee);
            emit ProtocolFeePaid(msg.sender, feeRecipient, fee, net);
        }
        _approvePortal(net);
        portal.depositToAztecPublic(to, net, secretHash);
        _clearPortalAllowance();
    }

    function rescueToken(uint256 amount) external nonReentrant {
        feeJuice.safeTransfer(rescueBeneficiary, amount);
    }

    function _forwardEthServiceFee() internal {
        uint256 value = msg.value;
        if (value == 0) return;
        (bool ok,) = feeRecipient.call{value: value}("");
        require(ok, "ETH_FEE");
        emit EthServiceFeePaid(msg.sender, feeRecipient, value);
    }

    function _splitFee(uint256 gross) internal pure returns (uint256 fee, uint256 net) {
        fee = (gross * FEE_BPS) / BPS_DENOMINATOR;
        net = gross - fee;
    }

    function _mintAtLeast(uint256 totalNeeded) internal {
        uint256 mintAmt = feeAssetHandler.mintAmount();
        require(mintAmt > 0, "mintAmount=0");
        uint256 mintsNeeded = (totalNeeded + mintAmt - 1) / mintAmt;
        for (uint256 i = 0; i < mintsNeeded; i++) {
            feeAssetHandler.mint(address(this));
        }
    }

    function _approvePortal(uint256 amount) internal {
        feeJuice.forceApprove(address(portal), amount);
    }

    function _clearPortalAllowance() internal {
        feeJuice.forceApprove(address(portal), 0);
    }

    function _refundSurplus() internal {
        uint256 surplus = feeJuice.balanceOf(address(this));
        if (surplus > 0) {
            feeJuice.safeTransfer(rescueBeneficiary, surplus);
        }
    }
}
