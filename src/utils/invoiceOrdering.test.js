import { sortServiceInvoices } from "./invoiceOrdering";

describe("sortServiceInvoices", () => {
  test("places the newest invoice first using creation timestamps", () => {
    const older = { invoiceNo: "SI2026-100001", createdAt: "2026-09-12T09:00:00Z" };
    const newest = { invoiceNo: "SI2026-100002", createdAt: "2026-09-12T11:00:00Z" };
    const middle = { invoiceNo: "SI2026-100003", createdAt: "2026-09-12T10:00:00Z" };

    expect(sortServiceInvoices([older, newest, middle])).toEqual([newest, middle, older]);
  });

  test("falls back to invoice date and keeps equal records stable", () => {
    const first = { invoiceNo: "SI2026-100001", date: "2026-09-12" };
    const second = { invoiceNo: "SI2026-100002", date: "2026-09-12" };
    const older = { invoiceNo: "SI2026-100000", date: "2026-09-11" };

    expect(sortServiceInvoices([first, second, older])).toEqual([second, first, older]);
  });

  test("does not mutate the API array", () => {
    const input = [
      { invoiceNo: "SI2026-100001", createdAt: "2026-09-11T09:00:00Z" },
      { invoiceNo: "SI2026-100002", createdAt: "2026-09-12T09:00:00Z" },
    ];

    const original = [...input];
    sortServiceInvoices(input);
    expect(input).toEqual(original);
  });
});
