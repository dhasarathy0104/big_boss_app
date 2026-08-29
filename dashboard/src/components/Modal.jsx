import { X } from 'lucide-react';

// Generic centered dialog — used for the employee/admin "edit" forms opened
// from a table row's pencil icon. Click outside or the X to close.
export default function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="card-title" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
