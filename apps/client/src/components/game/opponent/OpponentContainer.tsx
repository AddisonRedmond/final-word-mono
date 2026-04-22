const OpponentsContainer: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <div
      style={{ maxWidth: "33%" }}
      className="flex w-1/4 flex-grow flex-wrap items-center justify-evenly px-2"
    >
      {children}
    </div>
  );
};

export default OpponentsContainer;
