// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GoBridge} from "../src/GoBridge.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("FeeJuice", "FJ") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockHandler {
    MockToken public token;
    uint256 public mintAmount;

    constructor(MockToken token_, uint256 mintAmount_) {
        token = token_;
        mintAmount = mintAmount_;
    }

    function mint(address recipient) external {
        token.mint(recipient, mintAmount);
    }
}

contract MockPortal {
    IERC20 public token;
    bool public reenter;
    GoBridge public bridge;
    bytes32 public lastTo;
    uint256 public lastAmount;
    bytes32 public lastSecret;

    constructor(IERC20 token_) {
        token = token_;
    }

    function setReenter(GoBridge bridge_) external {
        reenter = true;
        bridge = bridge_;
    }

    function depositToAztecPublic(bytes32 to, uint256 amount, bytes32 secretHash)
        external
        returns (bytes32, uint256)
    {
        lastTo = to;
        lastAmount = amount;
        lastSecret = secretHash;
        require(token.transferFrom(msg.sender, address(this), amount), "pull");
        if (reenter) {
            bridge.mintAndBridge(to, amount, secretHash);
        }
        return (bytes32(uint256(1)), 1);
    }
}

contract TheftPortal {
    IERC20 public token;

    constructor(IERC20 token_) {
        token = token_;
    }

    function depositToAztecPublic(bytes32, uint256, bytes32) external returns (bytes32, uint256) {
        uint256 bal = token.allowance(msg.sender, address(this));
        require(token.transferFrom(msg.sender, address(this), bal), "steal");
        return (bytes32(uint256(2)), 2);
    }
}

contract GoBridgeTest is Test {
    MockToken internal token;
    MockHandler internal handler;
    MockPortal internal portal;
    GoBridge internal bridge;
    address internal rescue = makeAddr("rescue");
    address internal feeWallet = makeAddr("trezor");
    address internal user = makeAddr("user");

    function setUp() public {
        token = new MockToken();
        handler = new MockHandler(token, 100 ether);
        portal = new MockPortal(token);
        bridge = new GoBridge(address(token), address(portal), address(handler), rescue, feeWallet);
    }

    function test_MintAndBridgeSkimsFeeAndRefundsSurplus() public {
        bytes32 to = bytes32(uint256(0xABC));
        bytes32 secret = bytes32(uint256(0xDEF));
        // gross 40 → net 38, fee 2; mint 100 → refund 60 to rescue after fee+deposit
        bridge.mintAndBridge(to, 40 ether, secret);

        assertEq(portal.lastAmount(), 38 ether);
        assertEq(token.balanceOf(feeWallet), 2 ether);
        assertEq(token.balanceOf(address(bridge)), 0);
        assertEq(token.balanceOf(rescue), 60 ether);
        assertEq(token.allowance(address(bridge), address(portal)), 0);
    }

    function test_BridgePullsGrossAndSkimsFee() public {
        token.mint(user, 100 ether);
        vm.startPrank(user);
        token.approve(address(bridge), 100 ether);
        bridge.bridge(bytes32(uint256(1)), 100 ether, bytes32(uint256(2)));
        vm.stopPrank();

        assertEq(portal.lastAmount(), 95 ether);
        assertEq(token.balanceOf(feeWallet), 5 ether);
        assertEq(token.balanceOf(user), 0);
        assertEq(token.balanceOf(address(bridge)), 0);
    }

    function test_TrustedPortalOnly_AttackerNeedsSeparateDeploy() public {
        TheftPortal thief = new TheftPortal(token);
        GoBridge evil = new GoBridge(address(token), address(thief), address(handler), rescue, feeWallet);
        evil.mintAndBridge(bytes32(uint256(1)), 40 ether, bytes32(uint256(2)));
        // net 38 deposited to thief via transferFrom allowance
        assertEq(token.balanceOf(address(thief)), 38 ether);

        bridge.mintAndBridge(bytes32(uint256(3)), 10 ether, bytes32(uint256(4)));
        assertEq(portal.lastAmount(), 9.5 ether);
        assertEq(token.balanceOf(address(portal)), 9.5 ether);
    }

    function test_RevertWhen_ReentrancyOnMint() public {
        portal.setReenter(bridge);
        vm.expectRevert();
        bridge.mintAndBridge(bytes32(uint256(1)), 10 ether, bytes32(uint256(2)));
    }

    function test_RevertWhen_FaucetDisabled() public {
        GoBridge noFaucet = new GoBridge(address(token), address(portal), address(0), rescue, feeWallet);
        vm.expectRevert(GoBridge.FaucetDisabled.selector);
        noFaucet.mintAndBridge(bytes32(uint256(1)), 1 ether, bytes32(uint256(2)));
    }

    function testFuzz_MintAndBridgeAmounts(uint256 amount) public {
        amount = bound(amount, 1, 500 ether);
        bridge.mintAndBridge(bytes32(uint256(1)), amount, bytes32(uint256(2)));
        uint256 fee = (amount * 500) / 10_000;
        uint256 net = amount - fee;
        assertEq(portal.lastAmount(), net);
        assertEq(token.balanceOf(address(bridge)), 0);
        assertEq(token.allowance(address(bridge), address(portal)), 0);
    }
}
