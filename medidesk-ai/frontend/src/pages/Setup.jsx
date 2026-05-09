import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../setup.css';

const Setup = ({ onSetupComplete }) => {
  const [step, setStep] = useState(1);
  const [doctorName, setDoctorName] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [language, setLanguage] = useState('en');
  const [columns, setColumns] = useState([]);
  const [customColumns, setCustomColumns] = useState([]);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState('text');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchColumns();
  }, []);

  const fetchColumns = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/setup');
      setColumns(response.data.columns || []);
    } catch (error) {
      console.error('Error fetching columns:', error);
    }
  };

  const handleNext = () => {
    if (step === 1 && doctorName && clinicName) {
      setStep(2);
    } else if (step === 2) {
      handleCompleteSetup();
    }
  };

  const handlePrevious = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const addCustomColumn = () => {
    if (newColumnName.trim()) {
      setCustomColumns([...customColumns, {
        name: newColumnName.trim(),
        type: newColumnType
      }]);
      setNewColumnName('');
      setNewColumnType('text');
    }
  };

  const removeCustomColumn = (index) => {
    setCustomColumns(customColumns.filter((_, i) => i !== index));
  };

  const handleCompleteSetup = async () => {
    setLoading(true);
    try {
      const response = await axios.post('http://localhost:5000/api/setup', {
        doctor_name: doctorName,
        clinic_name: clinicName,
        language: language,
        custom_columns: customColumns
      });

      if (response.data.success) {
        onSetupComplete(response.data.settings);
      }
    } catch (error) {
      console.error('Error completing setup:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <div className="setup-header">
          <h1>Welcome to MediDesk AI</h1>
          <p>Let's set up your patient management system</p>
        </div>

        <div className="setup-progress">
          <div className={`step ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className={`step ${step >= 2 ? 'active' : ''}`}>2</div>
        </div>

        {step === 1 && (
          <div className="setup-step">
            <h2>Clinic Information</h2>
            <div className="form-group">
              <label className="form-label">Doctor Name</label>
              <input
                type="text"
                className="form-input"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Dr. John Smith"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Clinic Name</label>
              <input
                type="text"
                className="form-input"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Medical Center"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Language</label>
              <select
                className="form-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-step">
            <h2>Custom Columns</h2>
            <p>Add custom fields to your patient table</p>
            
            <div className="default-columns">
              <h3>Default Columns (cannot be removed)</h3>
              <div className="column-list">
                {columns.filter(col => col.is_default).map(col => (
                  <div key={col.id} className="column-item default">
                    <span className="column-name">{col.column_name}</span>
                    <span className="column-type">{col.column_type}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="custom-columns-section">
              <h3>Custom Columns</h3>
              <div className="add-column-form">
                <input
                  type="text"
                  className="form-input"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="Column name"
                />
                <select
                  className="form-select"
                  value={newColumnType}
                  onChange={(e) => setNewColumnType(e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
                <button className="btn btn-primary" onClick={addCustomColumn}>
                  Add
                </button>
              </div>
              
              {customColumns.length > 0 && (
                <div className="column-list">
                  {customColumns.map((col, index) => (
                    <div key={index} className="column-item custom">
                      <span className="column-name">{col.name}</span>
                      <span className="column-type">{col.type}</span>
                      <button 
                        className="btn btn-outline btn-sm"
                        onClick={() => removeCustomColumn(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="setup-actions">
          {step > 1 && (
            <button className="btn btn-secondary" onClick={handlePrevious}>
              Previous
            </button>
          )}
          <button 
            className="btn btn-primary" 
            onClick={handleNext}
            disabled={loading || (step === 1 && (!doctorName || !clinicName))}
          >
            {loading ? 'Setting up...' : step === 2 ? 'Complete Setup' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Setup;
