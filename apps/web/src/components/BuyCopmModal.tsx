import { useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { MiniPayFallback } from './MiniPayFallback';

interface BuyCopmModalProps {
  onClose: () => void;
}

export function BuyCopmModal({ onClose }: BuyCopmModalProps) {
  const { address } = useAccount();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [useMiniPay, setUseMiniPay] = useState(false);

  const { sendTransaction } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash as `0x${string}` | undefined });

  const isRecipientValid = recipient === '' || isAddress(recipient);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRecipientValid) {
      setError('Invalid EVM address format. Please check the recipient address.');
      return;
    }
    if (recipient && recipient.toLowerCase() !== address?.toLowerCase()) {
      setShowWarning(true);
      return;
    }
    executePurchase();
  };

  const executePurchase = async () => {
    setError('');
    try {
      if (useMiniPay) {
        // MiniPay fallback: use MiniPay's send flow
        const result = await MiniPayFallback.send({
          to: recipient || address,
          amount,
          token: 'COPm',
        });
        setTxHash(result.txHash);
      } else {
        const result = await sendTransaction({
          to: recipient || address,
          value: BigInt(amount),
        });
        setTxHash(result);
      }
    } catch (err) {
      setError('Transaction failed. Trying MiniPay fallback...');
      setUseMiniPay(true);
      try {
        const result = await MiniPayFallback.send({
          to: recipient || address,
          amount,
          token: 'COPm',
        });
        setTxHash(result.txHash);
      } catch (fallbackErr) {
        setError('Both direct and MiniPay fallback failed. Please try again.');
      }
    }
  };

  const finalRecipient = recipient || address;
  const isSelf = finalRecipient.toLowerCase() === address?.toLowerCase();

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Buy COPm</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Recipient Address (optional, defaults to your wallet)
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
            />
          </label>
          {!isRecipientValid && <p className="error">Invalid EVM address format.</p>}
          <label>
            Amount (COPm)
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          {showWarning && (
            <div className="warning">
              <strong>Warning:</strong> You are about to send COPm to a different wallet.
              Please verify the recipient address is correct. This transaction cannot be undone.
            </div>
          )}
          <button type="submit" disabled={!isRecipientValid}>
            {showWarning ? 'Confirm Purchase' : 'Buy COPm'}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </form>
        {txHash && (
          <div className="summary">
            <h3>Purchase Summary</h3>
            <p>Recipient: {finalRecipient}</p>
            <p>Amount: {amount} COPm</p>
            <p>Transaction Hash: {txHash}</p>
            {receipt && <p>Status: {receipt.status === 'success' ? 'Success' : 'Failed'}</p>}
            {!isSelf && <p>Note: Funds were sent to the recipient above, not to your wallet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
