import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface InvestmentProposal {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
  category: string;
  riskLevel: number;
}

interface UserHistory {
  action: string;
  target: string;
  timestamp: number;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<InvestmentProposal[]>([]);
  const [filteredProposals, setFilteredProposals] = useState<InvestmentProposal[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ 
    name: "", 
    amount: "", 
    description: "",
    category: "growth",
    riskLevel: 5
  });
  const [selectedProposal, setSelectedProposal] = useState<InvestmentProposal | null>(null);
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [stats, setStats] = useState({
    totalProposals: 0,
    totalValue: 0,
    avgRisk: 0,
    verifiedCount: 0
  });

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    if (isConnected) {
      loadProposals();
    } else {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    filterProposals();
    calculateStats();
  }, [proposals, searchTerm, selectedCategory]);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const businessIds = await contract.getAllBusinessIds();
      const proposalsList: InvestmentProposal[] = [];

      for (const id of businessIds) {
        try {
          const data = await contract.getBusinessData(id);
          proposalsList.push({
            id,
            name: data.name,
            encryptedValue: null,
            publicValue1: Number(data.publicValue1),
            publicValue2: Number(data.publicValue2),
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            decryptedValue: Number(data.decryptedValue),
            isVerified: data.isVerified,
            category: Number(data.publicValue2) > 7 ? "high-risk" : "growth",
            riskLevel: Number(data.publicValue1)
          });
        } catch (e) {
          console.error('Error loading proposal:', e);
        }
      }

      setProposals(proposalsList);
      addUserHistory("LOAD", "All proposals", "success");
    } catch (error) {
      setTransactionStatus({ visible: true, status: "error", message: "Load failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setLoading(false);
    }
  };

  const filterProposals = () => {
    let filtered = proposals.filter(proposal => 
      proposal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proposal.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (selectedCategory !== "all") {
      filtered = filtered.filter(proposal => proposal.category === selectedCategory);
    }

    setFilteredProposals(filtered);
  };

  const calculateStats = () => {
    const totalProposals = proposals.length;
    const totalValue = proposals.reduce((sum, p) => sum + (p.isVerified ? p.decryptedValue : 0), 0);
    const avgRisk = proposals.length > 0 ? proposals.reduce((sum, p) => sum + p.riskLevel, 0) / proposals.length : 0;
    const verifiedCount = proposals.filter(p => p.isVerified).length;

    setStats({ totalProposals, totalValue, avgRisk, verifiedCount });
  };

  const addUserHistory = (action: string, target: string, status: string) => {
    const history: UserHistory = {
      action,
      target,
      timestamp: Date.now(),
      status
    };
    setUserHistory(prev => [history, ...prev.slice(0, 9)]);
  };

  const createProposal = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      return;
    }

    setCreatingProposal(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting proposal..." });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");

      const amountValue = parseInt(newProposalData.amount) || 0;
      const businessId = `proposal-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, amountValue);

      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newProposalData.riskLevel,
        0,
        newProposalData.description
      );

      setTransactionStatus({ visible: true, status: "pending", message: "Confirming..." });
      await tx.wait();

      addUserHistory("CREATE", newProposalData.name, "success");
      setTransactionStatus({ visible: true, status: "success", message: "Proposal created!" });
      
      await loadProposals();
      setShowCreateModal(false);
      setNewProposalData({ name: "", amount: "", description: "", category: "growth", riskLevel: 5 });
    } catch (error: any) {
      addUserHistory("CREATE", newProposalData.name, "failed");
      setTransactionStatus({ visible: true, status: "error", message: "Creation failed" });
    } finally {
      setCreatingProposal(false);
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptProposal = async (proposalId: string) => {
    if (!isConnected) return null;

    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return null;

      const proposalData = await contractRead.getBusinessData(proposalId);
      if (proposalData.isVerified) {
        return Number(proposalData.decryptedValue);
      }

      const encryptedValue = await contractRead.getEncryptedValue(proposalId);
      
      const result = await verifyDecryption(
        [encryptedValue],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(proposalId, abiEncodedClearValues, decryptionProof)
      );

      const clearValue = result.decryptionResult.clearValues[encryptedValue];
      addUserHistory("DECRYPT", proposalId, "success");
      return Number(clearValue);
    } catch (error) {
      addUserHistory("DECRYPT", proposalId, "failed");
      return null;
    }
  };

  const handleAvailableCheck = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "System available" });
        addUserHistory("CHECK", "System", "success");
      }
    } catch (error) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const renderStatsPanel = () => (
    <div className="stats-panel">
      <div className="stat-card neon-purple">
        <h3>Total Proposals</h3>
        <div className="stat-value">{stats.totalProposals}</div>
        <div className="stat-trend">FHE Protected</div>
      </div>
      <div className="stat-card neon-blue">
        <h3>Total Value</h3>
        <div className="stat-value">${stats.totalValue}K</div>
        <div className="stat-trend">Encrypted Assets</div>
      </div>
      <div className="stat-card neon-pink">
        <h3>Avg Risk</h3>
        <div className="stat-value">{stats.avgRisk.toFixed(1)}/10</div>
        <div className="stat-trend">Risk Level</div>
      </div>
      <div className="stat-card neon-green">
        <h3>Verified</h3>
        <div className="stat-value">{stats.verifiedCount}</div>
        <div className="stat-trend">On-chain</div>
      </div>
    </div>
  );

  const renderRiskChart = (proposal: InvestmentProposal) => (
    <div className="risk-chart">
      <div className="chart-header">
        <h4>Risk Analysis</h4>
        <span className={`risk-badge risk-${proposal.riskLevel}`}>Level {proposal.riskLevel}</span>
      </div>
      <div className="chart-bars">
        <div className="chart-bar">
          <div className="bar-label">Market Risk</div>
          <div className="bar-container">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, proposal.riskLevel * 10)}%` }}
            ></div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Liquidity</div>
          <div className="bar-container">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, (10 - proposal.riskLevel) * 10)}%` }}
            ></div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Potential Return</div>
          <div className="bar-container">
            <div 
              className="bar-fill return" 
              style={{ width: `${Math.min(100, proposal.publicValue1 * 8)}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1 className="neon-text">Confidential Investment Club</h1>
            <span className="tagline">FHE Protected Alpha</span>
          </div>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="neon-glow">🔐</div>
            <h2>Connect to Encrypted Club</h2>
            <p>Join the private investment community with fully homomorphic encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="neon-spinner"></div>
        <p>Initializing FHE Security...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header metal-header">
        <div className="logo">
          <h1 className="neon-text">Confidential Investment Club</h1>
          <span className="tagline">FHE Protected Alpha Strategies</span>
        </div>
        <div className="header-actions">
          <button className="neon-btn" onClick={handleAvailableCheck}>
            Check System
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-layout">
        <div className="left-panel">
          {renderStatsPanel()}
          
          <div className="history-panel metal-panel">
            <h3>Recent Activity</h3>
            <div className="history-list">
              {userHistory.map((item, index) => (
                <div key={index} className="history-item">
                  <span className={`status-${item.status}`}>{item.action}</span>
                  <span className="target">{item.target}</span>
                  <span className="time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="main-panel">
          <div className="panel-header">
            <div className="search-section">
              <input
                type="text"
                placeholder="Search proposals..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="neon-input"
              />
              <select 
                value={selectedCategory} 
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="neon-select"
              >
                <option value="all">All Categories</option>
                <option value="growth">Growth</option>
                <option value="high-risk">High Risk</option>
              </select>
            </div>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="neon-btn create-btn"
            >
              + New Proposal
            </button>
          </div>

          <div className="proposals-grid">
            {filteredProposals.map((proposal) => (
              <div 
                key={proposal.id}
                className="proposal-card metal-card"
                onClick={() => setSelectedProposal(proposal)}
              >
                <div className="card-header">
                  <h3>{proposal.name}</h3>
                  <span className={`category-tag ${proposal.category}`}>
                    {proposal.category}
                  </span>
                </div>
                <div className="card-content">
                  <p>{proposal.description}</p>
                  <div className="proposal-meta">
                    <span>Risk: {proposal.riskLevel}/10</span>
                    <span>{new Date(proposal.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="card-footer">
                  <div className={`status ${proposal.isVerified ? 'verified' : 'encrypted'}`}>
                    {proposal.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </div>
                  <button 
                    className="neon-btn small"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const value = await decryptProposal(proposal.id);
                      if (value !== null) {
                        setProposals(prev => prev.map(p => 
                          p.id === proposal.id ? { ...p, decryptedValue: value, isVerified: true } : p
                        ));
                      }
                    }}
                  >
                    {proposal.isVerified ? 'View' : 'Decrypt'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal metal-modal">
            <div className="modal-header">
              <h2>New Investment Proposal</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Proposal Name</label>
                <input
                  type="text"
                  value={newProposalData.name}
                  onChange={(e) => setNewProposalData({...newProposalData, name: e.target.value})}
                  className="neon-input"
                />
              </div>
              <div className="form-group">
                <label>Investment Amount ($K)</label>
                <input
                  type="number"
                  value={newProposalData.amount}
                  onChange={(e) => setNewProposalData({...newProposalData, amount: e.target.value})}
                  className="neon-input"
                />
                <span className="input-note">FHE Encrypted Integer</span>
              </div>
              <div className="form-group">
                <label>Risk Level (1-10)</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={newProposalData.riskLevel}
                  onChange={(e) => setNewProposalData({...newProposalData, riskLevel: parseInt(e.target.value)})}
                  className="neon-slider"
                />
                <span className="risk-value">{newProposalData.riskLevel}</span>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newProposalData.description}
                  onChange={(e) => setNewProposalData({...newProposalData, description: e.target.value})}
                  className="neon-textarea"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="neon-btn secondary">
                Cancel
              </button>
              <button 
                onClick={createProposal}
                disabled={creatingProposal || isEncrypting}
                className="neon-btn primary"
              >
                {creatingProposal ? 'Encrypting...' : 'Create Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProposal && (
        <div className="modal-overlay">
          <div className="detail-modal metal-modal">
            <div className="modal-header">
              <h2>{selectedProposal.name}</h2>
              <button onClick={() => setSelectedProposal(null)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="proposal-details">
                <div className="detail-section">
                  <h4>Description</h4>
                  <p>{selectedProposal.description}</p>
                </div>
                <div className="detail-section">
                  <h4>Investment Details</h4>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span>Amount:</span>
                      <strong>
                        {selectedProposal.isVerified ? 
                          `$${selectedProposal.decryptedValue}K` : 
                          '🔒 Encrypted'
                        }
                      </strong>
                    </div>
                    <div className="detail-item">
                      <span>Risk Level:</span>
                      <strong>{selectedProposal.riskLevel}/10</strong>
                    </div>
                    <div className="detail-item">
                      <span>Created:</span>
                      <strong>{new Date(selectedProposal.timestamp * 1000).toLocaleDateString()}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Creator:</span>
                      <strong>{selectedProposal.creator.slice(0, 8)}...{selectedProposal.creator.slice(-6)}</strong>
                    </div>
                  </div>
                </div>
                {renderRiskChart(selectedProposal)}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedProposal(null)} className="neon-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === 'success' ? '✓' : 
               transactionStatus.status === 'error' ? '✗' : '⏳'}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

