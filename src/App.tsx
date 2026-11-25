import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ErrorBoundary} from './components/ErrorBoundary';
import {AuthProvider} from './contexts/AuthContext';
import {StoreProvider} from './contexts/StoreContext';
import {ThemeProvider} from './contexts/ThemeContext';
import {AdminLoginPage} from './pages/admin/AdminLoginPage';
import {AdminSettings} from './pages/admin/AdminSettings';
import {CustomersManager} from './pages/admin/CustomersManager';
import {CustomizationManager} from './pages/admin/CustomizationManager';
import {DashboardOverview} from './pages/admin/DashboardOverview';
import {OrdersManager} from './pages/admin/OrdersManager';
import {PaymentsManager} from './pages/admin/PaymentsManager';
import {ProductsManager} from './pages/admin/ProductsManager';
import {CheckoutPage} from './pages/store/CheckoutPage';
import {CustomerAccountPage} from './pages/store/CustomerAccountPage';
import {HomePage} from './pages/store/HomePage';
import {LegalPage} from './pages/store/LegalPage';
import {OrderTrackingPage} from './pages/store/OrderTrackingPage';
import {ProductDetailPage} from './pages/store/ProductDetailPage';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <StoreProvider>
            <BrowserRouter>
              <Routes>
                {/* Customer Website Routes */}
                <Route path="/" element={<HomePage />} />
                <Route path="/product/:slug" element={<ProductDetailPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/track" element={<OrderTrackingPage />} />
                <Route path="/account" element={<CustomerAccountPage />} />
                <Route path="/terms" element={<LegalPage type="terms" />} />
                <Route path="/privacy" element={<LegalPage type="privacy" />} />

                {/* Separate Admin Panel Routes */}
                <Route path="/admin/login" element={<AdminLoginPage />} />
                <Route path="/admin" element={<DashboardOverview />} />
                <Route path="/admin/products" element={<ProductsManager />} />
                <Route path="/admin/orders" element={<OrdersManager />} />
                <Route path="/admin/payments" element={<PaymentsManager />} />
                <Route path="/admin/customization" element={<CustomizationManager />} />
                <Route path="/admin/customers" element={<CustomersManager />} />
                <Route path="/admin/settings" element={<AdminSettings />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </StoreProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
