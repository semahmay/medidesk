import React, { useState, useEffect } from 'react';
import axios from 'axios';
import PatientTable from '../components/PatientTable';
import PatientForm from '../components/PatientForm';
import AIChat from '../components/AIChat';
import '../dashboard.css';
import '../modal.css';

const Dashboard = ({ settings }) => {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState([]);

  useEffect(() => {
    fetchPatients();
    fetchColumns();
  }, []);

  const fetchPatients = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/patients');
      setPatients(response.data.patients || []);
    } catch (error) {
      console.error('Error fetching patients:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchColumns = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/columns');
      setColumns(response.data.columns || []);
    } catch (error) {
      console.error('Error fetching columns:', error);
    }
  };

  const handlePatientSelect = async (patient) => {
    try {
      const response = await axios.get(`http://localhost:5000/api/patients/${patient.id}`);
      setSelectedPatient(response.data.patient);
    } catch (error) {
      console.error('Error fetching patient details:', error);
    }
  };

  const handleAddPatient = () => {
    setEditingPatient(null);
    setShowPatientForm(true);
  };

  const handleEditPatient = (patient) => {
    setEditingPatient(patient);
    setShowPatientForm(true);
  };

  const handleDeletePatient = async (patientId) => {
    if (window.confirm('Are you sure you want to delete this patient?')) {
      try {
        await axios.delete(`http://localhost:5000/api/patients/${patientId}`);
        fetchPatients();
        if (selectedPatient && selectedPatient.id === patientId) {
          setSelectedPatient(null);
        }
      } catch (error) {
        console.error('Error deleting patient:', error);
      }
    }
  };

  const handlePatientFormClose = () => {
    setShowPatientForm(false);
    setEditingPatient(null);
  };

  const handlePatientSaved = () => {
    fetchPatients();
    handlePatientFormClose();
  };

  const handleColumnsChange = () => {
    fetchColumns();
    fetchPatients();
    if (selectedPatient) {
      handlePatientSelect(selectedPatient);
    }
  };

  const filteredPatients = patients.filter(patient =>
    patient.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const customColumns = columns.filter(col => !col.is_default);

  return (
    <div className="dashboard">
      <div className="layout-container">
        {/* Left Panel - Patient Table */}
        <div className="left-panel">
          <div className="panel-header">
            <h2>Patients</h2>
            <button className="btn btn-primary" onClick={handleAddPatient}>
              Add Patient
            </button>
          </div>
          
          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              placeholder="Search patients by name or status..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : (
            <PatientTable
              patients={filteredPatients}
              selectedPatient={selectedPatient}
              onPatientSelect={handlePatientSelect}
              onEditPatient={handleEditPatient}
              onDeletePatient={handleDeletePatient}
              onColumnsChange={handleColumnsChange}
              fetchPatients={fetchPatients}
            />
          )}
        </div>

        {/* Right Panel - Patient Details */}
        <div className="right-panel">
          {selectedPatient ? (
            <div className="patient-details">
              <div className="patient-header">
                <h3>{selectedPatient.full_name}</h3>
                <span className={`status-badge status-${selectedPatient.status.toLowerCase()}`}>
                  {selectedPatient.status}
                </span>
              </div>
              
              <div className="patient-info">
                <div className="info-item">
                  <label>Phone:</label>
                  <span>{selectedPatient.phone || 'N/A'}</span>
                </div>
                <div className="info-item">
                  <label>Email:</label>
                  <span>{selectedPatient.email || 'N/A'}</span>
                </div>
                <div className="info-item">
                  <label>Appointment:</label>
                  <span>{selectedPatient.appointment || 'N/A'}</span>
                </div>
                <div className="info-item">
                  <label>Notes:</label>
                  <span>{selectedPatient.notes || 'N/A'}</span>
                </div>
              </div>

              {/* Custom Fields */}
              {customColumns.length > 0 && (
                <div className="custom-fields-section">
                  <h4>Custom Fields</h4>
                  <div className="custom-fields-list">
                    {customColumns.map(column => (
                      <div key={column.id} className="info-item">
                        <label>{column.column_name}:</label>
                        <span>
                          {selectedPatient[column.column_name] || 
                           (column.column_type === 'boolean' ? 'No' : 'N/A')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <AIChat patient={selectedPatient} />
            </div>
          ) : (
            <div className="no-patient-selected">
              <div className="empty-state">
                <h3>No Patient Selected</h3>
                <p>Select a patient from the table to view their details and chat with AI</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPatientForm && (
        <PatientForm
          patient={editingPatient}
          onClose={handlePatientFormClose}
          onSave={handlePatientSaved}
        />
      )}
    </div>
  );
};

export default Dashboard;
