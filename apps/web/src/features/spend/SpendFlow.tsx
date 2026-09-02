import React, { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { spendAbi } from '../contracts/spendAbi';

// Mock data for operators and giftcards
const OPERATORS = [
  { id: 'claro', name: 'Claro', packages: [
    { id: 'p1', name: '5,000 COP', price: 5000 },
    { id: 'p2', name: '10,000 COP', price: 10000 },
    { id: 'p3', name: '20,000 COP', price: 20000 },
  ]},
  { id: 'tigo', name: 'Tigo', packages: [
    { id: 'p4', name: '5,000 COP', price: 5000 },
    { id: 'p5', name: '10,000 COP', price: 10000 },
    { id: 'p6', name: '20,000 COP', price: 20000 },
  ]},
];

const GIFT_CATEGORIES = [
  {
    id: 'restaurants',
    name: 'Restaurants',
    cards: [
      { id: 'c1', name: 'McDonald\'s', denominations: [10000, 20000, 50000] },
      { id: 'c2', name: 'Starbucks', denominations: [10000, 20000, 50000] },
    ],
  },
  {
    id: 'retail',
    name: 'Retail',
    cards: [
      { id: 'c3', name: 'Amazon', denominations: [20000, 50000, 100000] },
      { id: 'c4', name: 'Exito', denominations: [10000, 20000, 50000] },
    ],
  },
];

// Mock backend to store orders (in a real app, this would be a server call)
const mockBackend = {
  orders: [] as any[],
  createOrder(order: any) {
    const id = 'ORD-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const newOrder = { ...order, id, status: 'pending', createdAt: new Date().toISOString() };
    this.orders.push(newOrder);
    return newOrder;
  },
  confirmOrder(id: string) {
    const order = this.orders.find((o) => o.id === id);
    if (order) order.status = 'confirmed';
    return order;
  },
};

type Step = 'type' | 'operator' | 'package' | 'phone' | 'email' | 'summary' | 'payment' | 'confirmation';

export function SpendFlow() {
  const { address } = useAccount();
  const [step, setStep] = useState<Step>('type');
  const [spendType, setSpendType] = useState<'recharge' | 'giftcard' | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [pkg, setPkg] = useState<any | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [card, setCard] = useState<any | null>(null);
  const [denomination, setDenomination] = useState<number | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { writeContract } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash as any });

  const handleTypeSelect = (type: 'recharge' | 'giftcard') => {
    setSpendType(type);
    setStep(type === 'recharge' ? 'operator' : 'category');
  };

  const handleOperatorSelect = (opId: string) => {
    setOperator(opId);
    setStep('package');
  };

  const handlePackageSelect = (p: any) => {
    setPkg(p);
    setStep('phone');
  };

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('email');
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('summary');
  };

  const handleCategorySelect = (catId: string) => {
    setCategory(catId);
    setStep('card');
  };

  const handleCardSelect = (c: any) => {
    setCard(c);
    setStep('denomination');
  };

  const handleDenominationSelect = (den: number) => {
    setDenomination(den);
    setStep('email');
  };

  const handleSummarySubmit = async () => {
    // Create order reference before payment
    const orderData = {
      type: spendType,
      operator: operator,
      package: pkg?.name,
      phone: phone,
      email: email,
      category: category,
      card: card?.name,
      denomination: denomination,
      amount: spendType === 'recharge' ? pkg?.price : denomination,
      userAddress: address,
    };
    const order = mockBackend.createOrder(orderData);
    setOrderId(order.id);

    // Simulate payment (in real app, call contract)
    setStep('payment');
    try {
      // Mock payment confirmation - in real app, this would be a contract call
      // For demo, we simulate a successful transaction
      const mockTxHash = '0x' + Math.random().toString(16).substring(2);
      setTxHash(mockTxHash);
      // Simulate confirmation
      setTimeout(() => {
        mockBackend.confirmOrder(order.id);
        setStep('confirmation');
      }, 2000);
    } catch (error) {
      console.error('Payment failed', error);
    }
  };

  const handleBack = () => {
    const backMap: Record<Step, Step> = {
      type: 'type',
      operator: 'type',
      package: 'operator',
      phone: 'package',
      email: spendType === 'recharge' ? 'phone' : 'denomination',
      summary: 'email',
      payment: 'summary',
      confirmation: 'type',
    };
    setStep(backMap[step]);
  };

  const renderTypeSelection = () => (
    <div className="spend-type-selection">
      <h2>What would you like to buy?</h2>
      <button onClick={() => handleTypeSelect('recharge')}>Recargas</button>
      <button onClick={() => handleTypeSelect('giftcard')}>Giftcards</button>
    </div>
  );

  const renderOperatorSelection = () => (
    <div>
      <h2>Select Operator</h2>
      {OPERATORS.map((op) => (
        <button key={op.id} onClick={() => handleOperatorSelect(op.id)}>
          {op.name}
        </button>
      ))}
      <button onClick={handleBack}>Back</button>
    </div>
  );

  const renderPackageSelection = () => {
    const op = OPERATORS.find((o) => o.id === operator);
    return (
      <div>
        <h2>Select Package</h2>
        {op?.packages.map((p) => (
          <button key={p.id} onClick={() => handlePackageSelect(p)}>
            {p.name}
          </button>
        ))}
        <button onClick={handleBack}>Back</button>
      </div>
    );
  };

  const renderPhoneInput = () => (
    <form onSubmit={handlePhoneSubmit}>
      <h2>Enter Phone Number</h2>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="3001234567"
        required
      />
      <button type="submit">Next</button>
      <button type="button" onClick={handleBack}>Back</button>
    </form>
  );

  const renderEmailInput = () => (
    <form onSubmit={handleEmailSubmit}>
      <h2>Enter Email</h2>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
      />
      <button type="submit">Next</button>
      <button type="button" onClick={handleBack}>Back</button>
    </form>
  );

  const renderCategorySelection = () => (
    <div>
      <h2>Select Category</h2>
      {GIFT_CATEGORIES.map((cat) => (
        <button key={cat.id} onClick={() => handleCategorySelect(cat.id)}>
          {cat.name}
        </button>
      ))}
      <button onClick={handleBack}>Back</button>
    </div>
  );

  const renderCardSelection = () => {
    const cat = GIFT_CATEGORIES.find((c) => c.id === category);
    return (
      <div>
        <h2>Select Card</h2>
        {cat?.cards.map((c) => (
          <button key={c.id} onClick={() => handleCardSelect(c)}>
            {c.name}
          </button>
        ))}
        <button onClick={handleBack}>Back</button>
      </div>
    );
  };

  const renderDenominationSelection = () => (
    <div>
      <h2>Select Denomination</h2>
      {card?.denominations.map((den: number) => (
        <button key={den} onClick={() => handleDenominationSelect(den)}>
          {den.toLocaleString()} COP
        </button>
      ))}
      <button onClick={handleBack}>Back</button>
    </div>
  );

  const renderSummary = () => {
    const amount = spendType === 'recharge' ? pkg?.price : denomination;
    return (
      <div>
        <h2>Order Summary</h2>
        <p>Type: {spendType === 'recharge' ? 'Recarga' : 'Giftcard'}</p>
        {spendType === 'recharge' && (
          <>
            <p>Operator: {OPERATORS.find((o) => o.id === operator)?.name}</p>
            <p>Package: {pkg?.name}</p>
            <p>Phone: {phone}</p>
          </>
        )}
        {spendType === 'giftcard' && (
          <>
            <p>Category: {GIFT_CATEGORIES.find((c) => c.id === category)?.name}</p>
            <p>Card: {card?.name}</p>
            <p>Denomination: {denomination?.toLocaleString()} COP</p>
          </>
        )}
        <p>Email: {email}</p>
        <p>Total: {amount?.toLocaleString()} COP</p>
        <button onClick={handleSummarySubmit}>Confirm and Pay</button>
        <button onClick={handleBack}>Back</button>
      </div>
    );
  };

  const renderPayment = () => (
    <div>
      <h2>Processing Payment...</h2>
      <p>Order ID: {orderId}</p>
      <p>Please wait while we confirm your transaction.</p>
    </div>
  );

  const renderConfirmation = () => (
    <div>
      <h2>Payment Confirmed!</h2>
      <p>Your order ID is: <strong>{orderId}</strong></p>
      <p>You will receive a confirmation email at {email}.</p>
      <button onClick={() => { setStep('type'); setSpendType(null); setOperator(null); setPkg(null); setPhone(''); setEmail(''); setCategory(null); setCard(null); setDenomination(null); setOrderId(null); setTxHash(null); }}>
        Start New Order
      </button>
    </div>
  );

  return (
    <div className="spend-flow">
      <h1>Spend</h1>
      {step === 'type' && renderTypeSelection()}
      {step === 'operator' && renderOperatorSelection()}
      {step === 'package' && renderPackageSelection()}
      {step === 'phone' && renderPhoneInput()}
      {step === 'email' && renderEmailInput()}
      {step === 'category' && renderCategorySelection()}
      {step === 'card' && renderCardSelection()}
      {step === 'denomination' && renderDenominationSelection()}
      {step === 'summary' && renderSummary()}
      {step === 'payment' && renderPayment()}
      {step === 'confirmation' && renderConfirmation()}
    </div>
  );
}
