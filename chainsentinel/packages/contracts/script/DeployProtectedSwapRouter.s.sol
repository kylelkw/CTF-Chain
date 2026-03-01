// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ProtectedSwapRouter.sol";

contract DeployProtectedSwapRouter is Script {
    function run() external returns (ProtectedSwapRouter router) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address unlinkExecutor = vm.envAddress("UNLINK_EXECUTOR");

        vm.startBroadcast(deployerKey);
        router = new ProtectedSwapRouter(unlinkExecutor);
        vm.stopBroadcast();
    }
}
