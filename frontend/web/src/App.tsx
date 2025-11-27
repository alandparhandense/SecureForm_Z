import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SecureFormData {
  id: string;
  title: string;
  description: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
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
  const [newFormData, setNewFormData] = useState({ title: "", description: "", value: "" });
  const [selectedForm, setSelectedForm] = useState<SecureFormData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [faqVisible, setFaqVisible] = useState(false);
  const formsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadForms();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const loadForms = async () => {
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
            description: businessData.description,
            encryptedValue: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setForms(formsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, formValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFormData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        Math.floor(Math.random() * 50),
        newFormData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secure form created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadForms();
      setShowCreateModal(false);
      setNewFormData({ title: "", description: "", value: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
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
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadForms();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadForms();
        return null;
      }
      
      setTransactionStatus({ status: "error", message: "Decryption failed: " + (e.message || "Unknown error"), visible: true });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredForms = forms.filter(form => 
    form.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    form.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const indexOfLastForm = currentPage * formsPerPage;
  const indexOfFirstForm = indexOfLastForm - formsPerPage;
  const currentForms = filteredForms.slice(indexOfFirstForm, indexOfLastForm);
  const totalPages = Math.ceil(filteredForms.length / formsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 Secure Form FHE</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to access the FHE-based secure form system</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure forms...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 Secure Form FHE</h1>
          <span>Fully Homomorphic Encryption Forms</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Form
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search forms..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button onClick={() => setFaqVisible(!faqVisible)} className="faq-btn">
            {faqVisible ? "Close FAQ" : "View FAQ"}
          </button>
        </div>

        {faqVisible && (
          <div className="faq-section">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-item">
              <strong>What is FHE?</strong>
              <p>Fully Homomorphic Encryption allows computations on encrypted data without decryption.</p>
            </div>
            <div className="faq-item">
              <strong>How is data secured?</strong>
              <p>All sensitive data is encrypted using Zama FHE before being stored on-chain.</p>
            </div>
            <div className="faq-item">
              <strong>Can I decrypt the data?</strong>
              <p>Only with proper authorization and through the verification process.</p>
            </div>
          </div>
        )}

        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Forms</h3>
            <div className="stat-value">{forms.length}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{forms.filter(f => f.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>Active Pages</h3>
            <div className="stat-value">{totalPages}</div>
          </div>
        </div>

        <div className="forms-section">
          <div className="section-header">
            <h2>Secure Forms</h2>
            <button onClick={loadForms} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="forms-list">
            {currentForms.length === 0 ? (
              <div className="no-forms">
                <p>No secure forms found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Form
                </button>
              </div>
            ) : currentForms.map((form, index) => (
              <div className="form-item" key={index} onClick={() => setSelectedForm(form)}>
                <div className="form-title">{form.title}</div>
                <div className="form-description">{form.description}</div>
                <div className="form-meta">
                  <span>Created: {new Date(form.timestamp * 1000).toLocaleDateString()}</span>
                  <span className={`status ${form.isVerified ? 'verified' : 'encrypted'}`}>
                    {form.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
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
          onClose={() => setSelectedForm(null)} 
          isDecrypting={fheIsDecrypting} 
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
            <strong>FHE Encryption</strong>
            <p>Sensitive data will be encrypted using Zama FHE technology</p>
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
            <label>Description</label>
            <textarea 
              name="description" 
              value={formData.description} 
              onChange={handleChange} 
              placeholder="Enter form description..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Encrypted Value (Integer only) *</label>
            <input 
              type="number" 
              name="value" 
              value={formData.value} 
              onChange={handleChange} 
              placeholder="Enter value to encrypt..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !formData.title || !formData.value} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Secure Form"}
          </button>
        </div>
      </div>
    </div>
  );
};

const FormDetailModal: React.FC<{
  form: SecureFormData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ form, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (form.isVerified) {
      setDecryptedValue(form.decryptedValue);
      return;
    }
    
    const value = await decryptData();
    setDecryptedValue(value);
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
              <span>Description:</span>
              <strong>{form.description}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{form.creator.substring(0, 6)}...{form.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(form.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Value:</div>
              <div className="data-value">
                {form.isVerified || decryptedValue !== null ? 
                  `${form.isVerified ? form.decryptedValue : decryptedValue} (Decrypted)` : 
                  "🔒 Encrypted (FHE Protected)"
                }
              </div>
              <button 
                className={`decrypt-btn ${(form.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 form.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔄 Re-verify" : 
                 "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="public-data">
              <div className="public-item">
                <span>Public Value 1:</span>
                <strong>{form.publicValue1}</strong>
              </div>
              <div className="public-item">
                <span>Public Value 2:</span>
                <strong>{form.publicValue2}</strong>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;