FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY RememberPress.Api/RememberPress.Api.csproj RememberPress.Api/
RUN dotnet restore RememberPress.Api/RememberPress.Api.csproj
COPY RememberPress.Api/ RememberPress.Api/
RUN dotnet publish RememberPress.Api/RememberPress.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV PORT=5000
EXPOSE 5000
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "RememberPress.Api.dll"]
