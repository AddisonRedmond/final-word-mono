import Navbar from "@/components/navigation/navbar";
import { api } from "@/utils/api";

const Duels = () => {
  const allFriends = api.friends.list.useQuery();

  return (
    <div>
      <Navbar />
      <p>DUELS</p>
    </div>
  );
};

export default Duels;
