require 'sinatra'
require 'pg'
require 'json'
require 'securerandom'

set :bind, '0.0.0.0'
set :port, ENV.fetch('PORT', '4567').to_i

def db
  @db ||= PG.connect(
    host: ENV.fetch('DB_HOST', 'timescaledb'),
    port: ENV.fetch('DB_PORT', '5432').to_i,
    dbname: ENV.fetch('DB_NAME', 'appdb'),
    user: ENV.fetch('DB_USER', 'appuser'),
    password: ENV.fetch('DB_PASSWORD', 'changeme')
  )
end

begin
  db.exec(<<~SQL)
    CREATE TABLE IF NOT EXISTS demand_forecasts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sku TEXT NOT NULL,
      store TEXT NOT NULL DEFAULT 'Store Alpha',
      predicted_units DOUBLE PRECISION NOT NULL,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
      period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  SQL
  puts "Demand forecasts table initialized"
rescue => e
  puts "DB init error: #{e.message}"
end

get '/health' do
  content_type :json
  { status: 'ok', service: 'demand-forecast-service' }.to_json
end

get '/api/forecasts' do
  content_type :json
  begin
    result = db.exec("SELECT * FROM demand_forecasts ORDER BY created_at DESC LIMIT 100")
    result.map { |r| r }.to_json
  rescue => e
    status 500
    { error: e.message }.to_json
  end
end

get '/api/forecasts/latest' do
  content_type :json
  begin
    result = db.exec(<<~SQL)
      SELECT DISTINCT ON (sku, store) *
      FROM demand_forecasts
      ORDER BY sku, store, created_at DESC
    SQL
    result.map { |r| r }.to_json
  rescue => e
    status 500
    { error: e.message }.to_json
  end
end

post '/api/forecasts' do
  content_type :json
  data = JSON.parse(request.body.read) rescue {}
  begin
    id = SecureRandom.uuid
    db.exec_params(
      "INSERT INTO demand_forecasts (id, sku, store, predicted_units, confidence, period_start, period_end) " \
      "VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        id,
        data.fetch('sku', 'SKU-SA-001'),
        data.fetch('store', 'Store Alpha'),
        data.fetch('predicted_units', rand * 500 + 10).to_f,
        data.fetch('confidence', 0.8).to_f,
        data.fetch('period_start', Time.now.utc.iso8601),
        data.fetch('period_end', (Time.now.utc + 86400).iso8601),
      ]
    )
    status 201
    { id: id, status: 'created' }.to_json
  rescue => e
    status 500
    { error: e.message }.to_json
  end
end

post '/api/forecasts/generate' do
  content_type :json
  stores = ["Store Alpha", "Store Beta", "Store Gamma", "East Distribution Center", "West Distribution Center"]
  sku_prefixes = %w[SKU-SA SKU-SB SKU-SC]
  count = 0
  begin
    stores.each do |store|
      sku_prefixes.each do |prefix|
        24.times do |h|
          sku = "#{prefix}-#{format('%03d', rand(1..100))}"
          start_time = Time.now.utc + (h * 3600)
          end_time = start_time + 3600
          db.exec_params(
            "INSERT INTO demand_forecasts (sku, store, predicted_units, confidence, period_start, period_end) " \
            "VALUES ($1, $2, $3, $4, $5, $6)",
            [sku, store, (rand * 490 + 10).round(2), (rand * 0.3 + 0.7).round(3),
             start_time.iso8601, end_time.iso8601]
          )
          count += 1
        end
      end
    end
    { generated: count }.to_json
  rescue => e
    status 500
    { error: e.message }.to_json
  end
end
