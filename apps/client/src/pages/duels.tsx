import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Button from "@/components/button";
import Modal from "@/components/modal";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";
import { api } from "@/utils/api";
import NewDuel from "@/components/duels/new-duel";
import type { Friend } from "@/components/friends/types";

const Duels = () => {
  const { data, isLoading, error } = api.friends.list.useQuery();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [usersToDuel, setUsersToDuel] = useState<string[]>();
  const friends: Friend[] = (data ?? [])
    .filter((friend) => friend.status === "accepted")
    .map((friend) => ({
      id: friend.id,
      name: friend.name ?? friend.email ?? "Unknown",
      email: friend.email ?? "",
      status: friend.status,
    }));

  return (
    <div className="h-screen flex items-center flex-col gap-y-2 ">
      {/* TODO: add navbar to the app, not individual pages */}

      <Navbar />
      <Tile word="DUEL" revealed={true} size="md" variant="correct" />
      <div className="flex flex-col items-center justify-center grow">
        <div className=" w-2xl h-10/12 outline outline-stone-200 bg-white rounded-md shadow-lg p-2">
          <div className="flex justify-between">
            <p className="font-semibold text-lg">DUELS</p>
            <Button onClick={() => setIsModalOpen(true)} variant="solid">
              New Duel
            </Button>
          </div>
          <hr className="my-2 border-none h-0.5 bg-stone-300" />
          <div>
            <p>DUEL1</p>
            <p>DUEL2</p>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <Modal onClose={() => setIsModalOpen(false)}>
            <NewDuel friends={friends} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Duels;
