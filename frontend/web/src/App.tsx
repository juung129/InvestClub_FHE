import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface InvestmentData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [investments, setInvestments] = useState<InvestmentData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingInvestment, setCreatingInvestment] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newInvestmentData, setNewInvestmentData] = useState({ 
    name: "", 
    amount: "", 
    description: "",
    riskLevel: "5"
  });
  const [selectedInvestment, setSelectedInvestment] = useState<InvestmentData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const investmentsList: InvestmentData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          investmentsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setInvestments(investmentsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createInvestment = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingInvestment(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating investment with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newInvestmentData.amount) || 0;
      const businessId = `investment-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newInvestmentData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newInvestmentData.riskLevel) || 5,
        0,
        newInvestmentData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Investment created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewInvestmentData({ name: "", amount: "", description: "", riskLevel: "5" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingInvestment(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredInvestments = investments.filter(investment =>
    investment.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    investment.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedInvestments = filteredInvestments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredInvestments.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Investment Club 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💎</div>
            <h2>Welcome to Confidential Investment Club</h2>
            <p>Connect your wallet to access encrypted investment strategies and protected alpha opportunities.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted investment proposals</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Collaborate securely with club members</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your investment strategies</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading confidential investment data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Investment Club 💎</h1>
          <p>FHE-Protected Alpha Strategies</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Proposal
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Proposals</h3>
            <div className="stat-value">{investments.length}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{investments.filter(i => i.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>Active Members</h3>
            <div className="stat-value">{new Set(investments.map(i => i.creator)).size}</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search investments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="investments-grid">
          {paginatedInvestments.map((investment, index) => (
            <div 
              key={index}
              className={`investment-card ${investment.isVerified ? 'verified' : ''}`}
              onClick={() => setSelectedInvestment(investment)}
            >
              <div className="card-header">
                <h3>{investment.name}</h3>
                <span className={`status-badge ${investment.isVerified ? 'verified' : 'pending'}`}>
                  {investment.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                </span>
              </div>
              <p className="description">{investment.description}</p>
              <div className="card-details">
                <div className="detail-item">
                  <span>Risk Level:</span>
                  <span>{investment.publicValue1}/10</span>
                </div>
                <div className="detail-item">
                  <span>Created:</span>
                  <span>{new Date(investment.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="card-footer">
                <span className="creator">By: {investment.creator.substring(0, 6)}...{investment.creator.substring(38)}</span>
                {investment.isVerified && (
                  <span className="amount">Amount: {investment.decryptedValue}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}

        {investments.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">💎</div>
            <h3>No Investment Proposals Yet</h3>
            <p>Be the first to create an encrypted investment proposal</p>
            <button onClick={() => setShowCreateModal(true)} className="create-btn">
              Create First Proposal
            </button>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <CreateInvestmentModal 
          onSubmit={createInvestment} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingInvestment} 
          investmentData={newInvestmentData} 
          setInvestmentData={setNewInvestmentData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedInvestment && (
        <InvestmentDetailModal 
          investment={selectedInvestment}
          onClose={() => setSelectedInvestment(null)}
          decryptData={decryptData}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>Confidential Investment Club - FHE Protected Alpha Strategies</p>
          <div className="footer-links">
            <span>Privacy First</span>
            <span>Encrypted Collaboration</span>
            <span>Alpha Protection</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const CreateInvestmentModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  investmentData: any;
  setInvestmentData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, investmentData, setInvestmentData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setInvestmentData({ ...investmentData, [name]: intValue });
    } else {
      setInvestmentData({ ...investmentData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Create Encrypted Investment Proposal</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption Active</strong>
            <p>Investment amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Proposal Name *</label>
            <input 
              type="text" 
              name="name" 
              value={investmentData.name} 
              onChange={handleChange} 
              placeholder="Enter proposal name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Investment Amount (Encrypted) *</label>
            <input 
              type="number" 
              name="amount" 
              value={investmentData.amount} 
              onChange={handleChange} 
              placeholder="Enter amount..." 
              step="1"
              min="0"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Risk Level (1-10) *</label>
            <input 
              type="range" 
              min="1" 
              max="10" 
              name="riskLevel" 
              value={investmentData.riskLevel} 
              onChange={handleChange} 
            />
            <div className="risk-display">Risk: {investmentData.riskLevel}/10</div>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={investmentData.description} 
              onChange={handleChange} 
              placeholder="Describe your investment strategy..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !investmentData.name || !investmentData.amount || !investmentData.description} 
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

const InvestmentDetailModal: React.FC<{
  investment: InvestmentData;
  onClose: () => void;
  decryptData: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ investment, onClose, decryptData, isDecrypting }) => {
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (investment.isVerified) {
      setDecryptedAmount(investment.decryptedValue);
      return;
    }
    
    const amount = await decryptData(investment.id);
    if (amount !== null) {
      setDecryptedAmount(amount);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h2>Investment Proposal Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="investment-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Proposal Name:</label>
                <span>{investment.name}</span>
              </div>
              <div className="info-item">
                <label>Creator:</label>
                <span>{investment.creator}</span>
              </div>
              <div className="info-item">
                <label>Created:</label>
                <span>{new Date(investment.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="info-item">
                <label>Risk Level:</label>
                <span>{investment.publicValue1}/10</span>
              </div>
            </div>
            
            <div className="description-section">
              <label>Strategy Description:</label>
              <p>{investment.description}</p>
            </div>
            
            <div className="encryption-section">
              <h3>FHE Protection Status</h3>
              <div className="encryption-status">
                <div className={`status-item ${investment.isVerified ? 'verified' : 'encrypted'}`}>
                  <span className="status-icon">
                    {investment.isVerified ? '✅' : '🔒'}
                  </span>
                  <span className="status-text">
                    {investment.isVerified ? 'On-chain Verified' : 'FHE Encrypted'}
                  </span>
                </div>
                
                <div className="amount-display">
                  <label>Investment Amount:</label>
                  <div className="amount-value">
                    {investment.isVerified ? 
                      `${investment.decryptedValue} (Verified)` :
                      decryptedAmount !== null ?
                      `${decryptedAmount} (Decrypted)` :
                      '🔒 Encrypted'
                    }
                  </div>
                </div>
                
                <button 
                  onClick={handleDecrypt}
                  disabled={isDecrypting}
                  className={`decrypt-btn ${investment.isVerified || decryptedAmount !== null ? 'decrypted' : ''}`}
                >
                  {isDecrypting ? 'Decrypting...' : 
                   investment.isVerified ? '✅ Verified' :
                   decryptedAmount !== null ? '🔄 Re-verify' : '🔓 Decrypt'}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
          {!investment.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="primary-btn"
            >
              {isDecrypting ? 'Verifying...' : 'Verify on-chain'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;