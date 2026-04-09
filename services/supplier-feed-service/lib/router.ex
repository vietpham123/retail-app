defmodule ExternalDataService.Router do
  use Plug.Router

  plug :match
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason
  plug :dispatch

  get "/health" do
    send_json(conn, 200, %{status: "ok", service: "supplier-feed-service"})
  end

  # Supplier feed data for retail supply chain
  get "/api/external" do
    suppliers = ["TextilePro Inc", "StitchWorks Global", "FabricFirst Ltd", "DenimCraft Co", "StyleSource LLC"]
    data = Enum.map(suppliers, fn supplier ->
      %{
        supplier_name: supplier,
        lead_time_days: :rand.uniform(30) + 1,
        available_units: :rand.uniform(5000) + 100,
        unit_cost: Float.round(:rand.uniform() * 50 + 5, 2),
        last_updated: DateTime.utc_now() |> DateTime.to_iso8601()
      }
    end)
    send_json(conn, 200, data)
  end

  get "/api/external/current" do
    supplier = conn.params["supplier"] || "TextilePro Inc"
    data = %{
      supplier_name: supplier,
      lead_time_days: :rand.uniform(30) + 1,
      available_units: :rand.uniform(5000) + 100,
      unit_cost: Float.round(:rand.uniform() * 50 + 5, 2),
      last_updated: DateTime.utc_now() |> DateTime.to_iso8601()
    }
    send_json(conn, 200, data)
  end

  get "/api/external/forecast" do
    # 7-day supply chain forecast
    days = Enum.map(1..7, fn d ->
      %{
        day: d,
        availability: :rand.uniform(5000) + 500,
        lead_time: :rand.uniform(21) + 3
      }
    end)
    send_json(conn, 200, %{supplier: "TextilePro Inc", forecast_days: days})
  end

  match _ do
    send_json(conn, 404, %{error: "not found"})
  end

  defp send_json(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end
end
