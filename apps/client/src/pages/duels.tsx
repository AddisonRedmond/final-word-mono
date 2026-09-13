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
          <div>{/* same collapsable search input from friends */}</div>
          <div>{/* Scrollable friends list */}</div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center grow">
        <div className=" w-2xl h-full outline outline-stone-200 bg-white rounded-md shadow-lg p-2">
          <div>{/* same collapsable search input from friends */}</div>
          <div>{/* Scrollable friends list */}</div>
        </div>
      </div>
    </div>
  );
};

export default Duels;
