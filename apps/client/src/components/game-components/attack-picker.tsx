type AttackPickerProps = {};

const AttackPicker: React.FC<AttackPickerProps> = () => {
  return (
    <div className="flex py-2 gap-x-3 px-4 font-semibold rounded-full shadow-lg opacity-100">
      <button className="cursor-pointer">First</button>
      <button className="cursor-pointer">Random</button>
      <button className="cursor-pointer">Last</button>
    </div>
  );
};

export default AttackPicker;
