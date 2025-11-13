pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract InvestClub_FHE is ZamaEthereumConfig {
    
    struct Proposal {
        string title;
        euint32 encryptedVoteCount;
        uint256 publicValue1;
        uint256 publicValue2;
        string description;
        address creator;
        uint256 timestamp;
        uint32 decryptedVoteCount;
        bool isVerified;
    }
    
    struct Asset {
        string name;
        euint32 encryptedBalance;
        uint256 publicValue1;
        uint256 publicValue2;
        string description;
        address creator;
        uint256 timestamp;
        uint32 decryptedBalance;
        bool isVerified;
    }
    
    mapping(string => Proposal) public proposals;
    mapping(string => Asset) public assets;
    
    string[] public proposalIds;
    string[] public assetIds;
    
    event ProposalCreated(string indexed proposalId, address indexed creator);
    event AssetCreated(string indexed assetId, address indexed creator);
    event VoteCountVerified(string indexed proposalId, uint32 decryptedVoteCount);
    event BalanceVerified(string indexed assetId, uint32 decryptedBalance);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createProposal(
        string calldata proposalId,
        string calldata title,
        externalEuint32 encryptedVoteCount,
        bytes calldata inputProof,
        uint256 publicValue1,
        uint256 publicValue2,
        string calldata description
    ) external {
        require(bytes(proposals[proposalId].title).length == 0, "Proposal already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedVoteCount, inputProof)), "Invalid encrypted input");
        
        proposals[proposalId] = Proposal({
            title: title,
            encryptedVoteCount: FHE.fromExternal(encryptedVoteCount, inputProof),
            publicValue1: publicValue1,
            publicValue2: publicValue2,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedVoteCount: 0,
            isVerified: false
        });
        
        FHE.allowThis(proposals[proposalId].encryptedVoteCount);
        FHE.makePubliclyDecryptable(proposals[proposalId].encryptedVoteCount);
        
        proposalIds.push(proposalId);
        emit ProposalCreated(proposalId, msg.sender);
    }
    
    function createAsset(
        string calldata assetId,
        string calldata name,
        externalEuint32 encryptedBalance,
        bytes calldata inputProof,
        uint256 publicValue1,
        uint256 publicValue2,
        string calldata description
    ) external {
        require(bytes(assets[assetId].name).length == 0, "Asset already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBalance, inputProof)), "Invalid encrypted input");
        
        assets[assetId] = Asset({
            name: name,
            encryptedBalance: FHE.fromExternal(encryptedBalance, inputProof),
            publicValue1: publicValue1,
            publicValue2: publicValue2,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedBalance: 0,
            isVerified: false
        });
        
        FHE.allowThis(assets[assetId].encryptedBalance);
        FHE.makePubliclyDecryptable(assets[assetId].encryptedBalance);
        
        assetIds.push(assetId);
        emit AssetCreated(assetId, msg.sender);
    }
    
    function verifyVoteCount(
        string calldata proposalId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(!proposals[proposalId].isVerified, "Vote count already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(proposals[proposalId].encryptedVoteCount);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        proposals[proposalId].decryptedVoteCount = decodedValue;
        proposals[proposalId].isVerified = true;
        
        emit VoteCountVerified(proposalId, decodedValue);
    }
    
    function verifyBalance(
        string calldata assetId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(assets[assetId].name).length > 0, "Asset does not exist");
        require(!assets[assetId].isVerified, "Balance already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(assets[assetId].encryptedBalance);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        assets[assetId].decryptedBalance = decodedValue;
        assets[assetId].isVerified = true;
        
        emit BalanceVerified(assetId, decodedValue);
    }
    
    function getEncryptedVoteCount(string calldata proposalId) external view returns (euint32) {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        return proposals[proposalId].encryptedVoteCount;
    }
    
    function getEncryptedBalance(string calldata assetId) external view returns (euint32) {
        require(bytes(assets[assetId].name).length > 0, "Asset does not exist");
        return assets[assetId].encryptedBalance;
    }
    
    function getProposal(string calldata proposalId) external view returns (
        string memory title,
        uint256 publicValue1,
        uint256 publicValue2,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedVoteCount
    ) {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        Proposal storage data = proposals[proposalId];
        
        return (
            data.title,
            data.publicValue1,
            data.publicValue2,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedVoteCount
        );
    }
    
    function getAsset(string calldata assetId) external view returns (
        string memory name,
        uint256 publicValue1,
        uint256 publicValue2,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedBalance
    ) {
        require(bytes(assets[assetId].name).length > 0, "Asset does not exist");
        Asset storage data = assets[assetId];
        
        return (
            data.name,
            data.publicValue1,
            data.publicValue2,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedBalance
        );
    }
    
    function getAllProposalIds() external view returns (string[] memory) {
        return proposalIds;
    }
    
    function getAllAssetIds() external view returns (string[] memory) {
        return assetIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

