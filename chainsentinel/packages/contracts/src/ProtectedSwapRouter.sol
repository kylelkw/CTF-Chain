// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IUnlinkExecutor {
    function execute(bytes calldata encryptedPayload) external payable returns (bytes memory result);
}

contract ProtectedSwapRouter {
    error InvalidTarget();
    error CallFailed(bytes reason);

    IUnlinkExecutor public immutable unlinkExecutor;

    event StandardSwapRouted(address indexed user, address indexed target, uint256 value, bytes4 selector);
    event ProtectedSwapRouted(address indexed user, address indexed executor, uint256 value, bytes32 payloadHash);

    constructor(address _unlinkExecutor) {
        if (_unlinkExecutor == address(0)) revert InvalidTarget();
        unlinkExecutor = IUnlinkExecutor(_unlinkExecutor);
    }

    function routeStandardSwap(address target, bytes calldata data) external payable returns (bytes memory result) {
        if (target == address(0)) revert InvalidTarget();

        (bool ok, bytes memory returnData) = target.call{value: msg.value}(data);
        if (!ok) revert CallFailed(returnData);

        emit StandardSwapRouted(msg.sender, target, msg.value, _selector(data));
        return returnData;
    }

    function routeProtectedSwap(bytes calldata encryptedPayload) external payable returns (bytes memory result) {
        bytes memory returnData = unlinkExecutor.execute{value: msg.value}(encryptedPayload);
        emit ProtectedSwapRouted(msg.sender, address(unlinkExecutor), msg.value, keccak256(encryptedPayload));
        return returnData;
    }

    function _selector(bytes calldata data) private pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly {
            sel := calldataload(data.offset)
        }
    }
}
