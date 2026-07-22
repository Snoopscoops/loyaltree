
// ============================================================
// CASHIER APP - React Component
// ============================================================
// File: CashierApp.jsx
// Stack: React + Axios
// ============================================================

import React, { useState, useRef } from 'react';
import axios from 'axios';

const API_BASE = 'https://api.loyaltypass.io/api/v1';

function CashierApp({ businessPublicId, staffToken }) {
  const [mode, setMode] = useState('scan'); // scan | confirm | success
  const [customer, setCustomer] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [transactionId, setTransactionId] = useState('');
  const [amount, setAmount] = useState('');
  const [staffPin, setStaffPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const videoRef = useRef(null);

  // Simulated QR scan (in production: use html5-qrcode library)
  const handleScan = async (customerPublicId) => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(
        `${API_BASE}/business/${businessPublicId}/customers/${customerPublicId}`
      );
      setCustomer(response.data);
      setMode('confirm');
    } catch (err) {
      setError('Customer not found or invalid QR code');
    } finally {
      setLoading(false);
    }
  };

  const handleAddStamp = async () => {
    if (!transactionId || !amount || !staffPin) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.post(
        `${API_BASE}/business/${businessPublicId}/stamps`,
        {
          customer_public_id: customer.customer.public_id,
          transaction_id: transactionId,
          transaction_amount_cents: parseInt(amount) * 100,
          payment_method: 'card',
          staff_pin: staffPin
        },
        { headers: { Authorization: `Bearer ${staffToken}` } }
      );

      setScanResult(response.data);
      setMode('success');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add stamp');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMode('scan');
    setCustomer(null);
    setScanResult(null);
    setTransactionId('');
    setAmount('');
    setError('');
  };

  // RENDER: Scan Mode
  if (mode === 'scan') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>📱 LoyaltyPass Scanner</h1>
          <p style={styles.subtitle}>Scan customer QR code to add stamp</p>
        </div>

        <div style={styles.scannerBox}>
          {/* In production: html5-qrcode scanner here */}
          <div style={styles.mockScanner}>
            <p style={styles.mockText}>Camera feed would appear here</p>
            <p style={styles.mockHint}>Simulate scan with customer ID:</p>
            <input 
              type="text" 
              placeholder="Paste customer public ID"
              style={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan(e.target.value);
              }}
            />
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {loading && <div style={styles.loading}>Scanning...</div>}
      </div>
    );
  }

  // RENDER: Confirm Mode
  if (mode === 'confirm') {
    const { customer: cust, stamps, program, unlocked_rewards } = customer;
    const progress = stamps.current_progress;
    const goal = program.stamp_goal;

    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>✅ Customer Found</h1>
        </div>

        <div style={styles.card}>
          <div style={styles.customerInfo}>
            <h2 style={styles.customerName}>{cust.name}</h2>
            <p style={styles.customerPhone}>{cust.phone}</p>
            <p style={styles.memberSince}>Member since {new Date(cust.member_since).toLocaleDateString()}</p>
          </div>

          {/* Stamp Progress */}
          <div style={styles.progressSection}>
            <p style={styles.progressLabel}>
              {stamps.reward_unlocked 
                ? '🎉 REWARD UNLOCKED!' 
                : `${stamps.stamps_until_reward} more until ${program.reward_name}`
              }
            </p>
            <div style={styles.progressBar}>
              {Array.from({ length: goal }).map((_, i) => (
                <div 
                  key={i} 
                  style={{
                    ...styles.stampSlot,
                    background: i < progress ? program.primary_color : '#e2e8f0',
                    color: i < progress ? 'white' : '#94a3b8'
                  }}
                >
                  {i < progress ? '✓' : i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Unlocked Rewards */}
          {unlocked_rewards.length > 0 && (
            <div style={styles.rewardsBox}>
              <p style={styles.rewardsTitle}>🔓 Ready to Redeem:</p>
              {unlocked_rewards.map(r => (
                <div key={r.public_id} style={styles.rewardItem}>
                  {program.reward_name} (expires {new Date(r.expires_at).toLocaleDateString()})
                </div>
              ))}
            </div>
          )}

          {/* Transaction Form */}
          <div style={styles.formSection}>
            <h3 style={styles.formTitle}>Add New Stamp</h3>

            <input
              type="text"
              placeholder="Transaction ID (from POS)"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              style={styles.input}
            />

            <input
              type="number"
              placeholder="Amount ($)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={styles.input}
            />

            <input
              type="password"
              placeholder="Your Staff PIN"
              value={staffPin}
              onChange={(e) => setStaffPin(e.target.value)}
              style={styles.input}
            />

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.buttonRow}>
              <button onClick={reset} style={styles.secondaryBtn}>Cancel</button>
              <button 
                onClick={handleAddStamp} 
                disabled={loading}
                style={styles.primaryBtn}
              >
                {loading ? 'Processing...' : '✓ Confirm & Add Stamp'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: Success Mode
  if (mode === 'success') {
    return (
      <div style={styles.container}>
        <div style={styles.successCard}>
          <div style={styles.successIcon}>🎉</div>
          <h2 style={styles.successTitle}>Stamp Added!</h2>

          <div style={styles.successDetails}>
            <p><strong>Customer:</strong> {scanResult.customer_name}</p>
            <p><strong>Stamp #:</strong> {scanResult.stamp_number}</p>
            <p><strong>Total Stamps:</strong> {scanResult.total_stamps_now}</p>

            {scanResult.reward_unlocked ? (
              <div style={styles.rewardUnlocked}>
                <p style={styles.rewardText}>🎁 REWARD UNLOCKED!</p>
                <p>Customer will receive a push notification</p>
              </div>
            ) : (
              <p>{scanResult.stamps_until_reward} more until reward</p>
            )}
          </div>

          <button onClick={reset} style={styles.primaryBtn}>
            Scan Next Customer
          </button>
        </div>
      </div>
    );
  }
}

// Inline styles for demo
const styles = {
  container: { maxWidth: 480, margin: '0 auto', padding: 20, fontFamily: 'system-ui' },
  header: { textAlign: 'center', marginBottom: 24 },
  title: { fontSize: 24, margin: 0, color: '#1e293b' },
  subtitle: { color: '#64748b', margin: '8px 0 0 0' },
  scannerBox: { background: '#f8fafc', borderRadius: 16, padding: 40, textAlign: 'center' },
  mockScanner: { border: '2px dashed #cbd5e1', borderRadius: 12, padding: 40 },
  mockText: { color: '#94a3b8', marginBottom: 16 },
  mockHint: { color: '#64748b', fontSize: 14, marginBottom: 12 },
  input: { width: '100%', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 16, marginBottom: 12, boxSizing: 'border-box' },
  error: { background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginTop: 12, fontSize: 14 },
  loading: { color: '#3b82f6', textAlign: 'center', marginTop: 12 },
  card: { background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  customerInfo: { marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' },
  customerName: { margin: 0, fontSize: 20, color: '#1e293b' },
  customerPhone: { color: '#64748b', margin: '4px 0' },
  memberSince: { color: '#94a3b8', fontSize: 12, margin: 0 },
  progressSection: { marginBottom: 20 },
  progressLabel: { fontWeight: 600, color: '#1e293b', marginBottom: 12 },
  progressBar: { display: 'flex', gap: 8, justifyContent: 'center' },
  stampSlot: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 },
  rewardsBox: { background: '#fef3c7', borderRadius: 8, padding: 12, marginBottom: 20 },
  rewardsTitle: { margin: '0 0 8px 0', fontWeight: 600, color: '#92400e' },
  rewardItem: { color: '#78350f', fontSize: 14 },
  formSection: { marginTop: 20 },
  formTitle: { fontSize: 16, margin: '0 0 12px 0', color: '#1e293b' },
  buttonRow: { display: 'flex', gap: 12, marginTop: 16 },
  primaryBtn: { flex: 1, background: '#3b82f6', color: 'white', border: 'none', padding: 14, borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { flex: 1, background: '#f1f5f9', color: '#475569', border: 'none', padding: 14, borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  successCard: { background: 'white', borderRadius: 16, padding: 40, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  successIcon: { fontSize: 48, marginBottom: 16 },
  successTitle: { margin: '0 0 20px 0', color: '#1e293b' },
  successDetails: { color: '#475569', lineHeight: 1.6, marginBottom: 24 },
  rewardUnlocked: { background: '#dcfce7', color: '#166534', padding: 16, borderRadius: 8, margin: '16px 0' },
  rewardText: { fontWeight: 700, fontSize: 18, margin: '0 0 8px 0' }
};

export default CashierApp;
