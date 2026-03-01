// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ProtectedSwapRouter.sol";

contract MockRouterTarget {
    uint256 public lastValue;
    uint256 public lastInput;

    function ping(uint256 input) external payable returns (uint256) {
        lastValue = msg.value;
        lastInput = input;
        return input + 1;
    }
}

contract MockUnlinkExecutor is IUnlinkExecutor {
    bytes32 public lastPayloadHash;
    uint256 public lastValue;

    function execute(bytes calldata encryptedPayload) external payable returns (bytes memory result) {
        lastPayloadHash = keccak256(encryptedPayload);
        lastValue = msg.value;
        return abi.encode(uint256(42));
    }
}

contract ProtectedSwapRouterTest is Test {
    MockUnlinkExecutor internal unlinkExecutor;
    MockRouterTarget internal standardTarget;
    ProtectedSwapRouter internal router;

    function setUp() public {
        unlinkExecutor = new MockUnlinkExecutor();
        standardTarget = new MockRouterTarget();
        router = new ProtectedSwapRouter(address(unlinkExecutor));
    }

    function test_routeStandardSwap_forwardsCallDataAndValue() public {
        bytes memory callData = abi.encodeWithSelector(MockRouterTarget.ping.selector, 7);

        bytes memory result = router.routeStandardSwap{value: 1 ether}(address(standardTarget), callData);

        assertEq(abi.decode(result, (uint256)), 8);
        assertEq(standardTarget.lastInput(), 7);
        assertEq(standardTarget.lastValue(), 1 ether);
    }

    function test_routeProtectedSwap_forwardsPayloadAndValue() public {
        bytes memory payload = abi.encodePacked("encrypted-payload");

        bytes memory result = router.routeProtectedSwap{value: 2 ether}(payload);

        assertEq(abi.decode(result, (uint256)), 42);
        assertEq(unlinkExecutor.lastPayloadHash(), keccak256(payload));
        assertEq(unlinkExecutor.lastValue(), 2 ether);
    }

    function test_routeStandardSwap_revertsForZeroTarget() public {
        vm.expectRevert(ProtectedSwapRouter.InvalidTarget.selector);
        router.routeStandardSwap(address(0), hex"");
    }
}
