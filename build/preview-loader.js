function waitForComponents() {
  return new Promise((resolve) => {
    const check = () => {
      if (
        window.React &&
        window.ReactDOM &&
        window.ThermalPreview &&
        window.ThermalReceipt &&
        window.invoiceData
      ) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

window.onload = async () => {
  await waitForComponents();

  const root = document.getElementById("root");

  ReactDOM.render(
    React.createElement(window.ThermalPreview, {
      invoice: window.invoiceData,
      isDuplicate: window.isDuplicate || false
    }),
    root
  );

  setTimeout(() => window.print(), 500);
};
