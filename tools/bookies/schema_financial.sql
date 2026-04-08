-- Personal financial context for Governor / planning (D1)
-- Remote: wrangler d1 execute bookies-db --remote --file=bookies/schema_financial.sql

CREATE TABLE IF NOT EXISTS financial_context (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO financial_context (key, value) VALUES
  ('overdraft_limit',      '0'),
  ('overdraft_used',       '0'),
  ('overdraft_0pct_end',   ''),
  ('student_debt_plan',    'plan_2'),
  ('student_debt_balance', '0'),
  ('student_loan_rate',    '4.3'),
  ('repayment_threshold',  '27295'),
  ('emergency_fund_target','0'),
  ('notes',                '');
