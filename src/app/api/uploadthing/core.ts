import { validateRequest } from "@/auth"; // User-Validierung importieren
import prisma from "@/lib/prisma"; // Prisma ORM für Datenbankaktionen importieren
import streamServerClient from "@/lib/stream"; // Stream-Client für Echtzeit-Updates importieren
import { createUploadthing, FileRouter } from "uploadthing/next"; // Uploadthing für Datei-Uploads importieren
import { UploadThingError, UTApi } from "uploadthing/server"; // Fehlerbehandlung und UploadThing-API importieren

// Uploadthing initialisieren
const f = createUploadthing();

// Router für Datei-Uploads definieren
export const fileRouter = {
  avatar: f({
    image: { maxFileSize: "512KB" }, // Avatar-Dateien mit max. 512KB
  })
    .middleware(async () => {
      // Anfrage validieren und Benutzer abrufen
      const { user } = await validateRequest();

      // Falls kein Benutzer authentifiziert ist, Fehler werfen
      if (!user) throw new UploadThingError("Unauthorized");

      // Benutzer in der Middleware zurückgeben
      return { user };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // Vorherige Avatar-URL aus den Metadaten des Benutzers holen
      const oldAvatarUrl = metadata.user.avatarUrl;

      // Wenn der Benutzer bereits einen Avatar hatte, diesen löschen
      if (oldAvatarUrl) {
        const key = oldAvatarUrl.split(
          `/a/${process.env.NEXT_PUBLIC_UPLOADTHING_APP_ID}/`,
        )[1]; // Extrahiere den Schlüssel der Datei

        // Lösche die alte Avatar-Datei mit der UploadThing-API
        await new UTApi().deleteFiles(key);
      }

      // Ersetze die URL des neuen Avatars mit der richtigen App-ID
      const newAvatarUrl = file.url.replace(
        "/f/",
        `/a/${process.env.NEXT_PUBLIC_UPLOADTHING_APP_ID}/`,
      );

      // Aktualisiere Benutzeravatar und Stream-Daten
      await Promise.all([
        prisma.user.update({
          where: { id: metadata.user.id }, // Benutzer anhand der ID finden
          data: {
            avatarUrl: newAvatarUrl, // Neue Avatar-URL setzen
          },
        }),
        streamServerClient.partialUpdateUser({
          id: metadata.user.id, // Stream-Benutzer-ID
          set: {
            image: newAvatarUrl, // Avatar-URL im Stream-Client aktualisieren
          },
        }),
      ]);

      // Rückgabe der neuen Avatar-URL
      return { avatarUrl: newAvatarUrl };
    }),

  attachment: f({
    // Konfiguration für Bild- und Videodateien mit maximaler Dateigröße
    image: { maxFileSize: "4MB", maxFileCount: 5 },
    video: { maxFileSize: "64MB", maxFileCount: 5 },
  })
    .middleware(async () => {
      // Anfrage validieren und Benutzer abrufen
      const { user } = await validateRequest();

      // Falls kein Benutzer authentifiziert ist, Fehler werfen
      if (!user) throw new UploadThingError("Unauthorized");

      // Keine zusätzlichen Daten zurückgeben, aber Zugriff gewähren
      return {};
    })
    .onUploadComplete(async ({ file }) => {
      // Nach dem Upload wird die Datei in der Datenbank gespeichert
      const media = await prisma.media.create({
        data: {
          url: file.url.replace(
            "/f/",
            `/a/${process.env.NEXT_PUBLIC_UPLOADTHING_APP_ID}/`,
          ), // URL der Datei speichern
          type: file.type.startsWith("image") ? "IMAGE" : "VIDEO", // Datei-Typ (Bild oder Video)
        },
      });

      // Rückgabe der Media-ID nach dem Speichern
      return { mediaId: media.id };
    }),
} satisfies FileRouter;

export type AppFileRouter = typeof fileRouter;
