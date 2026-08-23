import { describe, it, expect } from 'vitest';

// Pure logic test based on Trading/P&L formulas extracted from components
describe('Regression Pass 3: Trading / P&L Numerical Tests', () => {
  
  const calculateTrading = (income: number, expense: number, opening: number, closing: number) => {
    // gp = totalSales + closingStock - (totalDirect + openingStock)
    const totalSales = income;
    const totalDirect = expense;
    return totalSales + closing - (totalDirect + opening);
  };

  const calculatePL = (income: number, expense: number, tradingGp: number) => {
    // profit = inc.totalPaise - exp.totalPaise + tradingGp;
    return income - expense + tradingGp;
  };

  it('Case A & F: Direct income > direct expense (Gross Profit) -> Net Profit', () => {
    const openingStock = 1000;
    const closingStock = 1500;
    const directIncome = 5000; // Sales
    const directExpense = 3000; // Purchases
    
    const gp = calculateTrading(directIncome, directExpense, openingStock, closingStock);
    expect(gp).toBe(2500); // 5000 + 1500 - (3000 + 1000) = 2500

    const indirectIncome = 500;
    const indirectExpense = 1000;
    const np = calculatePL(indirectIncome, indirectExpense, gp);
    expect(np).toBe(2000); // 500 - 1000 + 2500 = 2000
  });

  it('Case B & E: Direct expense > direct income (Gross Loss)', () => {
    const openingStock = 1000;
    const closingStock = 500;
    const directIncome = 2000;
    const directExpense = 4000;
    
    const gp = calculateTrading(directIncome, directExpense, openingStock, closingStock);
    expect(gp).toBe(-2500); // 2000 + 500 - (4000 + 1000) = -2500
  });

  it('Case G: Net loss', () => {
    const gp = 1000;
    const indirectIncome = 200;
    const indirectExpense = 2000;
    const np = calculatePL(indirectIncome, indirectExpense, gp);
    expect(np).toBe(-800); // 200 - 2000 + 1000 = -800
  });
});
