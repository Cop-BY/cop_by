import { useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { copmAbi, copmAddress } from '../generated';
import { MiniPayFallback } from './MiniPayFallback';

interface BuyCopmModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  recipient: string;
  setRecipient: (value: string) => void;
}

export function BuyCopmModal({ isOpen, onClose, amount, recipient, setRecipient }: BuyCopmModalProps) {
  const { address } = useAccount();
  const [showWarning, setShowWarning] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const isRecipientValid = recipient === '' || isAddress(recipient);
  const isSelf = recipient === '' || recipient.toLowerCase() === address?.toLowerCase();

  const handleBuy = async () => {
    if (!isRecipientValid) {
      setError('Invalid recipient address. Please enter a valid EVM address.');
      return;
    }
    if (!isSelf && !showWarning) {
      setShowWarning(true);
      return;
    }
    setError(null);
    try {
      writeContract({
        address: copmAddress,
        abi: copmAbi,
        functionName: 'transfer',
        args: [recipient || address, BigInt(amount)],
      });
    } catch (e) {
      setError('Transaction failed. Trying MiniPay fallback...');
      // MiniPay fallback logic would go here
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Buy COPm</h2>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full border rounded px-3 py-2"
          />
          {!isRecipientValid && (
            <p className="text-red-500 text-sm mt-1">Invalid EVM address format.</p>
          )}
        </div>
        {showWarning && !isSelf && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 p-3 rounded mb-4">
            <strong>Warning:</strong> You are sending COPm to a different wallet. Double-check the address.
          </div>
        )}
        <div className="mb-4">
          <p>Amount: {amount} COPm</p>
          <p>Recipient: {recipient || address}</p>
        </div>
        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button
            onClick={handleBuy}
            disabled={!isRecipientValid || isPending || isConfirming}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isPending ? 'Confirming...' : isConfirming ? 'Processing...' : 'Buy'}
          </button>
        </div>
        {isConfirmed && (
          <div className="mt-4 p-3 bg-green-100 border border-green-400 rounded">
            <p>Transaction successful!</p>
            <p>Tx Hash: <a href={`https://celoscan.io/tx/${hash}`} target="_blank" className="text-blue-600 underline">{hash}</a></p>
            <p>Final Recipient: {recipient || address}</p>
          </div>
        )}
        {isConfirmed && !isSelf && <MiniPayFallback txHash={hash} recipient={recipient} />}
      </div>
    </div>
  );
}
