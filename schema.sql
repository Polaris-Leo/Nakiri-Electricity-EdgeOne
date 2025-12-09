# 仅初始化时使用，后续请勿修改此文件
CREATE TABLE IF NOT EXISTS electricity (
  timestamp TEXT,
  room_id TEXT,
  kWh REAL,
  UNIQUE(timestamp, room_id)
);