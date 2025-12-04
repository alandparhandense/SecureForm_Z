import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SecureFormData {
  id: string;
  title: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface FormStats {
  totalSubmissions: number;
  verifiedCount: number;
  avgValue: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<SecureFormData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingForm, setCreatingForm] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newFormData, setNewFormData] = useState({ title: "", value: "", description: "" });
  const [selectedForm, setSelectedForm] = useState<SecureFormData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [stats, setStats] = useState<FormStats>({ totalSubmissions: 0, verifiedCount: 0, avgValue: 0, recentActivity: 0 });
  const formsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
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
      const formsList: SecureFormData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          formsList.push({
            id: businessId,
            title: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setForms(formsList);
      calculateStats(formsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (formsData: SecureFormData[]) => {
    const totalSubmissions = formsData.length;
    const verifiedCount = formsData.filter(f => f.isVerified).length;
    const avgValue = formsData.length > 0 
      ? formsData.reduce((sum, f) => sum + f.publicValue1, 0) / formsData.length 
      : 0;
    const recentActivity = formsData.filter(f => 
      Date.now()/1000 - f.timestamp < 60 * 60 * 24
    ).length;

    setStats({ totalSubmissions, verifiedCount, avgValue, recentActivity });
  };

  const createForm = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingForm(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating secure form with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const formValue = parseInt(newFormData.value) || 0;
      const businessId = `form-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, formValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFormData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100) + 1,
        0,
        newFormData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secure form created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewFormData({ title: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingForm(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
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
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
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
    } finally { 
      setIsDecrypting(false); 
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
      setTransactionStatus({ visible: true, status: "error", message: "Contract check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredForms = forms.filter(form => 
    form.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    form.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedForms = filteredForms.slice((currentPage - 1) * formsPerPage, currentPage * formsPerPage);
  const totalPages = Math.ceil(filteredForms.length / formsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Secure Form 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access Secure Forms</h2>
            <p>Please connect your wallet to initialize the encrypted form system and access secure data collection.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and analyzing encrypted forms</p>
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
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure form system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Secure Form 🔐</h1>
          <p>Privacy-Preserving Data Collection</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Secure Form
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>Total Submissions</h3>
              <div className="stat-value">{stats.totalSubmissions}</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <h3>Verified Data</h3>
              <div className="stat-value">{stats.verifiedCount}</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-content">
              <h3>Average Value</h3>
              <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">🕒</div>
            <div className="stat-content">
              <h3>24h Activity</h3>
              <div className="stat-value">{stats.recentActivity}</div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search forms..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <span className="search-icon">🔍</span>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>

        <div className="forms-section">
          <h2>Secure Form Submissions</h2>
          
          <div className="forms-list">
            {paginatedForms.length === 0 ? (
              <div className="no-forms">
                <p>No secure forms found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Create First Form
                </button>
              </div>
            ) : paginatedForms.map((form, index) => (
              <div 
                className={`form-item ${selectedForm?.id === form.id ? "selected" : ""} ${form.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedForm(form)}
              >
                <div className="form-header">
                  <h3>{form.title}</h3>
                  <span className={`status-badge ${form.isVerified ? "verified" : "pending"}`}>
                    {form.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <p className="form-description">{form.description}</p>
                <div className="form-meta">
                  <span>Public Value: {form.publicValue1}</span>
                  <span>Created: {new Date(form.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="form-creator">By: {form.creator.substring(0, 6)}...{form.creator.substring(38)}</div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="page-btn"
              >
                Previous
              </button>
              <span className="page-info">Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="page-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateForm 
          onSubmit={createForm} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingForm} 
          formData={newFormData} 
          setFormData={setNewFormData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedForm && (
        <FormDetailModal 
          form={selectedForm} 
          onClose={() => { 
            setSelectedForm(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedForm.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateForm: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  formData: any;
  setFormData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, formData, setFormData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setFormData({ ...formData, [name]: intValue });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-form-modal">
        <div className="modal-header">
          <h2>New Secure Form</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Sensitive data will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Form Title *</label>
            <input 
              type="text" 
              name="title" 
              value={formData.title} 
              onChange={handleChange} 
              placeholder="Enter form title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Sensitive Value (Integer only) *</label>
            <input 
              type="number" 
              name="value" 
              value={formData.value} 
              onChange={handleChange} 
              placeholder="Enter sensitive value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={formData.description} 
              onChange={handleChange} 
              placeholder="Enter form description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !formData.title || !formData.value || !formData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Secure Form"}
          </button>
        </div>
      </div>
    </div>
  );
};

const FormDetailModal: React.FC<{
  form: SecureFormData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ form, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="form-detail-modal">
        <div className="modal-header">
          <h2>Form Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{form.title}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{form.creator.substring(0, 6)}...{form.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(form.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Value:</span>
              <strong>{form.publicValue1}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{form.description}</p>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            
            <div className="data-row">
              <div className="data-label">Sensitive Value:</div>
              <div className="data-value">
                {form.isVerified && form.decryptedValue ? 
                  `${form.decryptedValue} (On-chain Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(form.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : form.isVerified ? (
                  "✅ Verified"
                ) : decryptedValue !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Self-Relaying Decryption</strong>
                <p>Data is encrypted on-chain. Click "Verify Decryption" to perform offline decryption and on-chain verification.</p>
              </div>
            </div>
          </div>
          
          {(form.isVerified || decryptedValue !== null) && (
            <div className="analysis-section">
              <h3>Data Analysis</h3>
              <div className="value-display">
                <div className="value-item">
                  <span>Encrypted Value:</span>
                  <strong>
                    {form.isVerified ? 
                      `${form.decryptedValue} (On-chain Verified)` : 
                      `${decryptedValue} (Locally Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${form.isVerified ? 'verified' : 'local'}`}>
                    {form.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Public Reference:</span>
                  <strong>{form.publicValue1}</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!form.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

