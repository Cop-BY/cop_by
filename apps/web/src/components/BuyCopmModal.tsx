import { useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { MiniPayFallback } from './MiniPayFallback';

interface BuyCopmModalProps {
  onClose: () => void;
}

export function BuyCopmModal({ onClose }: BuyCopmModalProps) {
  const { address: userAddress } = useAccount();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useMiniPay, setUseMiniPay] = useState(false);

  const { sendTransaction } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash as `0x${string}` | undefined });

  const isRecipientValid = recipient === '' || isAddress(recipient);
  const isSelf = recipient.toLowerCase() === (userAddress?.toLowerCase() ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRecipientValid) {
      setError('Invalid EVM address. Please check the recipient address.');
      return;
    }
    if (recipient && !isSelf) {
      setShowWarning(true);
      return;
    }
    executePurchase();
  };

  const executePurchase = async () => {
    setError(null);
    try {
      const hash = await sendTransaction({
        to: recipient as `0x${string}`,
        value: BigInt(amount),
      });
      setTxHash(hash);
    } catch (err) {
      // If direct swap fails, try MiniPay fallback
      if (recipient && !isSelf) {
        setUseMiniPay(true);
      } else {
        setError(err instanceof Error ? err.message : 'Transaction failed');
      }
    }
  };

  const handleConfirmWarning = () => {
    setShowWarning(false);
    executePurchase();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Buy COPm</h2>
        {!txHash && !useMiniPay && (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Recipient Address (optional)</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                className="w-full border rounded px-3 py-2"
              />
              {!isRecipientValid && (
                <p className="text-red-600 text-sm mt-1">Invalid EVM address format.</p>
              )}
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Amount (COPm)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Buy
            </button>
          </form>
        )}
        {showWarning && (
          <div className="mt-4 p-4 bg-yellow-100 border border-yellow-400 rounded">
            <h3 className="font-bold text-yellow-800">Warning: Sending to a different recipient</h3>
            <p className="text-yellow-800 mt-2">
              You are about to send COPm to <strong>{recipient}</strong>. This address is different from your wallet.
              Please verify the address is correct. Transactions cannot be reversed.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleConfirmWarning}
                className="flex-1 bg-yellow-600 text-white py-2 rounded hover:bg-yellow-700"
              >
                I understand, continue
              </button>
              <button
                onClick={() => setShowWarning(false)}
                className="flex-1 bg-gray-300 py-2 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {txHash && (
          <div className="mt-4">
            <h3 className="font-bold">Purchase Submitted</h3>
            <p className="mt-2">
              Recipient: <strong>{recipient || userAddress}</strong>
            </p>
            <p className="mt-1">
              Transaction Hash: <span className="font-mono text-sm break-all">{txHash}</span>
            </p>
            {receipt ? (
              <p className="text-green-600 mt-2">Confirmed!</p>
            ) : (
              <p className="text-gray-600 mt-2">Waiting for confirmation...</p>
            )}
            <button
              onClick={onClose}
              className="mt-4 w-full bg-gray-200 py-2 rounded hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        )}
        {useMiniPay && (
          <MiniPayFallback
            recipient={recipient}
            amount={amount}
            onSuccess={(hash) => setTxHash(hash)}
            onError={(msg) => setError(msg)}
          />
        )}
      </div>
    </div>
  );
}
