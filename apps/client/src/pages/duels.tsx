import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import { api } from "@/utils/api";

const Duels = () => {
  const { data, isLoading, error } = api.friends.list.useQuery();

  return (
    <div className="h-screen flex items-center flex-col gap-y-2 py-5">
      {/* TODO: add navbar to the app, not individual pages */}
      <Navbar />
      <Tile word="DUEL" revealed={true} size="md" variant="correct" />
      <div className="flex flex-col items-center justify-center grow">
        <div className=" w-2xl h-10/12 outline outline-stone-200 bg-white rounded-md shadow-lg p-2">
          <div className="flex justify-between">
            <p className="font-semibold text-lg">DUELS</p>
            <button
              className={`float-right relative text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-md transition-all active:scale-95 bg-green-400 text-white`}
            >
              New Duel
            </button>
          </div>
          <hr className="my-2 border-none h-0.5 bg-stone-300" />
          <div>
            <p>DUEL1</p>
            <p>DUEL2</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Duels;
