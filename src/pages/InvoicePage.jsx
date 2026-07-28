import Layout from "../components/layout/Layout";
import InvoiceList from "../components/invoice/InvoiceList";

const InvoicePage = ({ title, invoiceFilter }) => (
  <Layout>
    <InvoiceList title={title} invoiceFilter={invoiceFilter} />
  </Layout>
);

export default InvoicePage;
