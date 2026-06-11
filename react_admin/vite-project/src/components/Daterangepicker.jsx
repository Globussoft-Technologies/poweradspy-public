import { DateRangePicker } from 'rsuite';
// rsuite's CSS is imported in src/index.css inside the `rsuite` cascade layer
// (so Tailwind utilities win over rsuite's global `td,th{padding:0}` reset).
// Importing it here too would re-add it unlayered and reintroduce the bug.
import moment from 'moment';
import Cookies from 'js-cookie';

const Daterangepicker = ({ onSelect, onDateSelectRange }) => {
  const createdAt = Cookies.get('createdAt');

  const minDate = moment(createdAt).toDate();
  const maxDate = moment().toDate();

  const handleDateChange = value => {
  
  };

  const isDisabledDate = date => {
    return date < minDate || date > maxDate;
  };

  return (
    <div className="date-range-containerinrep ">
      <DateRangePicker
        className="responsive-date-range-picker pickerrr1"
        onChange={handleDateChange}
        shouldDisableDate={isDisabledDate}
      />
    </div>
  );
};

export default Daterangepicker;
