pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecureForm is ZamaEthereumConfig {
    
    struct FormEntry {
        string formId;
        euint32 encryptedResponse;
        uint256 publicMetadata;
        address respondent;
        uint256 timestamp;
        uint32 decryptedResponse;
        bool isDecrypted;
    }
    
    mapping(string => FormEntry) public formEntries;
    string[] public formIds;
    
    event FormEntryCreated(string indexed formId, address indexed respondent);
    event ResponseDecrypted(string indexed formId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function submitFormEntry(
        string calldata formId,
        externalEuint32 encryptedResponse,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(bytes(formEntries[formId].formId).length == 0, "Form entry already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedResponse, inputProof)), "Invalid encrypted input");
        
        formEntries[formId] = FormEntry({
            formId: formId,
            encryptedResponse: FHE.fromExternal(encryptedResponse, inputProof),
            publicMetadata: publicMetadata,
            respondent: msg.sender,
            timestamp: block.timestamp,
            decryptedResponse: 0,
            isDecrypted: false
        });
        
        FHE.allowThis(formEntries[formId].encryptedResponse);
        FHE.makePubliclyDecryptable(formEntries[formId].encryptedResponse);
        
        formIds.push(formId);
        
        emit FormEntryCreated(formId, msg.sender);
    }
    
    function decryptResponse(
        string calldata formId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(formEntries[formId].formId).length > 0, "Form entry does not exist");
        require(!formEntries[formId].isDecrypted, "Response already decrypted");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(formEntries[formId].encryptedResponse);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        formEntries[formId].decryptedResponse = decodedValue;
        formEntries[formId].isDecrypted = true;
        
        emit ResponseDecrypted(formId, decodedValue);
    }
    
    function getEncryptedResponse(string calldata formId) external view returns (euint32) {
        require(bytes(formEntries[formId].formId).length > 0, "Form entry does not exist");
        return formEntries[formId].encryptedResponse;
    }
    
    function getFormEntry(string calldata formId) external view returns (
        uint256 publicMetadata,
        address respondent,
        uint256 timestamp,
        bool isDecrypted,
        uint32 decryptedResponse
    ) {
        require(bytes(formEntries[formId].formId).length > 0, "Form entry does not exist");
        FormEntry storage entry = formEntries[formId];
        
        return (
            entry.publicMetadata,
            entry.respondent,
            entry.timestamp,
            entry.isDecrypted,
            entry.decryptedResponse
        );
    }
    
    function getAllFormIds() external view returns (string[] memory) {
        return formIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

