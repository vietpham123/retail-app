import React, { useState, useEffect, useCallback } from 'react';
import {
  AppBar, Toolbar, Typography, Tabs, Tab, Box, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Card, CardContent, Grid,
  Select, MenuItem, Button, CircularProgress, Chip, IconButton, FormControl,
  InputLabel
} from '@mui/material';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// =========================================================
// AGENT: Update these constants from industry.yaml
// =========================================================

const APP_TITLE = "Retail Operations Platform";

const TAB_CONFIG = [
  { label: "Dashboard",        endpoint: "/api/analytics/dashboard" },
  { label: "Orders",           endpoint: "/api/orders" },
  { label: "Inventory",        endpoint: "/api/inventory" },
  { label: "Catalog",          endpoint: "/api/catalog" },
  { label: "Store Layout",     endpoint: "/api/topology" },
  { label: "Sales Analytics",  endpoint: "/api/analytics/trends" },
  { label: "Demand Forecast",  endpoint: "/api/forecasts" },
  { label: "Fulfillment",      endpoint: "/api/dispatch" },
  { label: "Supplier Feeds",   endpoint: "/api/external" },
  { label: "Notifications",    endpoint: "/api/notifications" },
  { label: "Dynamic Pricing",  endpoint: "/api/pricing" },
  { label: "Tasks",            endpoint: "/api/work-orders" },
  { label: "Fraud Detection",  endpoint: "/api/correlation" },
  { label: "Reports",          endpoint: "/api/aggregation" },
  { label: "POS Telemetry",    endpoint: "/api/telemetry" },
  { label: "Audit Log",        endpoint: "/api/audit" },
  { label: "Users",            endpoint: "/api/auth/users" },
];

const KPI_CONFIG = [
  { name: "Orders Today",      field: "orders_today",         format: "number",  color: "#2196f3" },
  { name: "Revenue",           field: "daily_revenue",        format: "currency",color: "#4caf50" },
  { name: "Items In Stock",    field: "total_in_stock",       format: "number",  color: "#ff9800" },
  { name: "Fulfillment Rate",  field: "fulfillment_rate_pct", format: "percent", color: "#9c27b0" },
  { name: "Cart Abandonment",  field: "abandonment_pct",      format: "percent", color: "#f44336" },
  { name: "Avg Ship Time",     field: "avg_ship_hours",       format: "number",  color: "#00bcd4" },
];

const formatKPI = (value, format) => {
  if (value === undefined || value === null) return '—';
  switch(format) {
    case 'percent': return `${Number(value).toFixed(1)}%`;
    case 'minutes': return `${Number(value).toFixed(0)} min`;
    case 'currency': return `$${Number(value).toFixed(2)}`;
    default: return Number(value).toLocaleString();
  }
};

export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [userList, setUserList] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    fetch('/api/auth/usernames')
      .then(r => r.json())
      .then(setUserList)
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = TAB_CONFIG[tab].endpoint;
      const res = await fetch(endpoint);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Fetch error:', err);
      setData(null);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    if (user) fetchData();
  }, [tab, user, fetchData]);

  const handleLogin = async () => {
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: selectedUser, password: 'changeme2026' }),
      });
      const json = await res.json();
      if (json.success) {
        setUser(json.user);
      } else {
        setLoginError(json.error || 'Login failed');
      }
    } catch {
      setLoginError('Connection error');
    }
  };

  // Login Screen
  if (!user) {
    return (
      <Box sx={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100vh', bgcolor:'#f5f5f5' }}>
        <Paper sx={{ p:4, minWidth:350 }}>
          <Typography variant="h5" gutterBottom>{APP_TITLE}</Typography>
          <FormControl fullWidth sx={{ mt:2 }}>
            <InputLabel>Select User</InputLabel>
            <Select value={selectedUser} label="Select User"
              onChange={e => setSelectedUser(e.target.value)}>
              {userList.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
            </Select>
          </FormControl>
          {loginError && <Typography color="error" sx={{ mt:1 }}>{loginError}</Typography>}
          <Button variant="contained" fullWidth sx={{ mt:2 }}
            disabled={!selectedUser} onClick={handleLogin}>Login</Button>
        </Paper>
      </Box>
    );
  }

  // Dashboard tab
  const renderDashboard = () => {
    if (!data) return null;
    return (
      <Grid container spacing={2} sx={{ mb:3 }}>
        {KPI_CONFIG.map(kpi => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={kpi.field}>
            <Card sx={{ borderLeft: `4px solid ${kpi.color}` }}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">{kpi.name}</Typography>
                <Typography variant="h4">{formatKPI(data[kpi.field], kpi.format)}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };

  // Generic data table for array responses
  const renderTable = () => {
    if (!data) return null;
    let rows = Array.isArray(data) ? data : [];
    if (!Array.isArray(data) && typeof data === 'object') {
      // Try to find an array in the response
      const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
      if (arrKey) rows = data[arrKey];
    }
    if (rows.length === 0) {
      return <Typography sx={{ p:2 }}>No data available</Typography>;
    }
    const columns = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
    return (
      <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {columns.map(col => (
                <TableCell key={col} sx={{ fontWeight:'bold', textTransform:'capitalize' }}>
                  {col.replace(/_/g, ' ')}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 100).map((row, i) => (
              <TableRow key={i} hover>
                {columns.map(col => (
                  <TableCell key={col}>
                    {col === 'severity' || col === 'status' || col === 'priority'
                      ? <Chip label={String(row[col])} size="small" color={
                          row[col] === 'critical' || row[col] === 'urgent' ? 'error' :
                          row[col] === 'high' ? 'warning' :
                          row[col] === 'open' || row[col] === 'active' ? 'info' : 'default'
                        } />
                      : String(row[col] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>{APP_TITLE}</Typography>
          <Chip label={user.username} sx={{ color: '#fff', mr:1 }} variant="outlined" />
          <Button color="inherit" size="small" onClick={() => setUser(null)}>Logout</Button>
        </Toolbar>
      </AppBar>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ bgcolor: '#fff', borderBottom: 1, borderColor: 'divider' }}>
        {TAB_CONFIG.map((t, i) => <Tab key={i} label={t.label} />)}
      </Tabs>

      <Box sx={{ p: 2, flexGrow: 1, bgcolor: '#fafafa' }}>
        {loading ? (
          <Box sx={{ display:'flex', justifyContent:'center', p:4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {tab === 0 ? renderDashboard() : null}
            {renderTable()}
          </>
        )}

        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" onClick={fetchData}>Refresh</Button>
          <Button variant="outlined" size="small" color="secondary"
            onClick={() => fetch('/api/simulate/cycle', { method: 'POST' }).then(fetchData)}>
            Simulate Data
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
