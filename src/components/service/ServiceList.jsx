import React from "react";
import { FaStar } from "react-icons/fa";
import "./ServiceList.css";

// Example service data (replace with your actual data source)
const exampleServices = [
  { id: 1, name: "Consulting", description: "Business consulting services", rate: 500, hours: 2 },
  { id: 2, name: "Repair", description: "Device repair and maintenance", rate: 300, hours: 1 },
  { id: 3, name: "Training", description: "Employee training session", rate: 800, hours: 3 },
];

const ServiceList = ({ services = exampleServices, onAddService }) => {
  return (
    <div className="service-list-container">
      <h4 className="service-list-title">Services</h4>
      <table className="service-list-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Service Name</th>
            <th>Description</th>
            <th>Rate</th>
            <th>Hours</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {services.map((svc, idx) => (
            <tr key={svc.id}>
              <td>{idx + 1}</td>
              <td>{svc.name}</td>
              <td>{svc.description}</td>
              <td>₹{svc.rate}</td>
              <td>{svc.hours}</td>
              <td>₹{(svc.rate * svc.hours).toFixed(2)}</td>
              <td>
                <button
                  className="add-service-btn"
                  onClick={() => onAddService && onAddService(svc)}
                >
                  <FaStar style={{ color: "#6366f1" }} /> Add
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ServiceList;
