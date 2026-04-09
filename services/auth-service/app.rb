require 'sinatra'
require 'pg'
require 'json'
require 'digest'
require 'securerandom'

set :bind, '0.0.0.0'
set :port, ENV.fetch('PORT', '4568').to_i

DEMO_PASSWORD = ENV.fetch('DEMO_PASSWORD', 'changeme2026')

def db
  @db ||= PG.connect(
    host: ENV.fetch('DB_HOST', 'timescaledb'),
    port: ENV.fetch('DB_PORT', '5432').to_i,
    dbname: ENV.fetch('DB_NAME', 'appdb'),
    user: ENV.fetch('DB_USER', 'appuser'),
    password: ENV.fetch('DB_PASSWORD', 'changeme')
  )
end

# --- Seed demo users from industry.yaml demo_users ---
# Retail demo users
DEMO_USERS = %w[
  admin_retail mgr_gap mgr_oldnavy mgr_macys
  assoc_gap_1 assoc_gap_2 assoc_oldnavy_1 assoc_macys_1
  wh_east_1 wh_east_2 wh_west_1
  viewer_corp_1 viewer_corp_2 viewer_corp_3 viewer_corp_4
]

begin
  db.exec(<<~SQL)
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  SQL

  password_hash = Digest::SHA256.hexdigest(DEMO_PASSWORD)
  DEMO_USERS.each do |username|
    db.exec_params(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING",
      [username, password_hash, username.start_with?('admin') ? 'admin' : username.start_with?('mgr') ? 'store_manager' : username.start_with?('assoc') ? 'store_associate' : username.start_with?('wh') ? 'warehouse_worker' : 'viewer']
    )
  end
  puts "Auth service: #{DEMO_USERS.size} demo users seeded"
rescue => e
  puts "DB init error: #{e.message}"
end

get '/health' do
  content_type :json
  { status: 'ok', service: 'auth-service' }.to_json
end

# --- Login ---
post '/api/auth/login' do
  content_type :json
  data = JSON.parse(request.body.read) rescue {}
  username = data['username'].to_s.strip
  password = data['password'].to_s

  if username.empty?
    status 400
    return { error: 'Username required' }.to_json
  end

  password_hash = Digest::SHA256.hexdigest(password)
  result = db.exec_params(
    "SELECT id, username, role FROM users WHERE username = $1 AND password_hash = $2",
    [username, password_hash]
  )

  if result.ntuples > 0
    user = result[0]
    { success: true, user: { id: user['id'], username: user['username'], role: user['role'] } }.to_json
  else
    status 401
    { success: false, error: 'Invalid credentials' }.to_json
  end
end

# --- List users ---
get '/api/auth/users' do
  content_type :json
  begin
    result = db.exec("SELECT id, username, role, created_at FROM users ORDER BY username")
    result.map { |r| r }.to_json
  rescue => e
    status 500
    { error: e.message }.to_json
  end
end

# --- User dropdown (for login UI) ---
get '/api/auth/usernames' do
  content_type :json
  DEMO_USERS.to_json
end
